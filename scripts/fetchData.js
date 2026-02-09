import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EIGHT_WEEKS_SECONDS = 60 * 60 * 24 * 7 * 8;
const START_TIMESTAMP = Math.floor(Date.now() / 1000) - EIGHT_WEEKS_SECONDS;
const MAX_CONCURRENT_BATCHES = 10;

const CHAINS = Object.entries(process.env)
    .filter(([k]) => k.startsWith('V4_SUBGRAPH_URL_'))
    .map(([k, v]) => {
        const name = k.replace('V4_SUBGRAPH_URL_', '');
        return {
            name,
            url: v,
            poolId: process.env[`${name}_POOL`],
        };
    })
    .filter(c => c.poolId);

const POOL_DETAILS_QUERY = `
query PoolDetails($poolId: String!) {
  pool(id: $poolId) {
    id
    token0 {
      id
      symbol
      decimals
    }
    token1 {
      id
      symbol
      decimals
    }
    feeTier
    txCount
    totalValueLockedUSD
  }
}
`;

const POOL_SWAPS_QUERY = `
query PoolSwaps($poolId: String!, $timestamp: Int!, $skip: Int!) {
  swaps(
    first: 1000
    skip: $skip
    orderBy: timestamp
    orderDirection: asc
    where: {
      pool: $poolId
      timestamp_gte: $timestamp
    }
  ) {
    id
    timestamp
    amount0
    amount1
    amountUSD
    pool {
      id
      feeTier
      token0 {
        decimals
      }
      token1 {
        decimals
      }
    }
  }
}
`;

class ConcurrencyLimiter {
    constructor(limit) {
        this.limit = limit;
        this.running = 0;
        this.queue = [];
    }

    async run(fn) {
        while (this.running >= this.limit) {
            await new Promise(resolve => this.queue.push(resolve));
        }

        this.running++;
        try {
            return await fn();
        } finally {
            this.running--;
            const resolve = this.queue.shift();
            if (resolve) resolve();
        }
    }
}

async function graphRequest(url, query, variables, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
            });

            const json = await res.json();
            if (json.errors) {
                const errorMsg = JSON.stringify(json.errors);
                if (errorMsg.includes('bad indexers') && i < retries) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
                throw new Error(JSON.stringify(json.errors));
            }
            return json.data;
        } catch (error) {
            if (i === retries) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function fetchPoolDetails(chain) {
    const data = await graphRequest(chain.url, POOL_DETAILS_QUERY, {
        poolId: chain.poolId,
    });

    if (!data.pool) {
        return null;
    }

    return data.pool;
}

async function fetchPoolSwapsSuperFast(chain, poolId) {
    const limiter = new ConcurrencyLimiter(MAX_CONCURRENT_BATCHES);

    const fetchBatch = async (skipValue) => {
        try {
            const data = await graphRequest(chain.url, POOL_SWAPS_QUERY, {
                poolId,
                timestamp: START_TIMESTAMP,
                skip: skipValue,
            });

            if (!data.swaps || data.swaps.length === 0) {
                return { swaps: [], hasMore: false };
            }

            return { swaps: data.swaps, hasMore: data.swaps.length === 1000 };
        } catch (error) {
            console.error(`   ⚠️  Batch at skip ${skipValue} failed:`, error.message);
            return { swaps: [], hasMore: false };
        }
    };

    const first = await fetchBatch(0);
    if (first.swaps.length === 0) {
        return [];
    }

    const allSwaps = [...first.swaps];

    if (!first.hasMore) {
        return allSwaps;
    }

    let skip = 1000;
    let emptyCount = 0;

    const CHUNK_SIZE = 50;

    for (let chunk = 0; chunk < 10; chunk++) {
        const chunkPromises = [];

        for (let i = 0; i < CHUNK_SIZE; i++) {
            const currentSkip = skip;
            skip += 1000;

            chunkPromises.push(
                limiter.run(() => fetchBatch(currentSkip))
            );
        }

        const results = await Promise.all(chunkPromises);

        for (const result of results) {
            if (result.swaps.length > 0) {
                allSwaps.push(...result.swaps);
                emptyCount = 0;
            } else {
                emptyCount++;
            }

            if (emptyCount >= 5) {
                return allSwaps;
            }

            if (!result.hasMore) {
                return allSwaps;
            }
        }
    }

    return allSwaps;
}

function calculateVolumeAndFees(swaps) {
    const dailyData = {};

    for (const swap of swaps) {
        const date = new Date(swap.timestamp * 1000);
        const dateKey = date.toISOString().split('T')[0];

        if (!dailyData[dateKey]) {
            dailyData[dateKey] = {
                timestamp: swap.timestamp,
                volume: 0,
                fees: 0,
            };
        }

        let volumeUSD = 0;
        if (swap.amountUSD && swap.amountUSD !== '0') {
            volumeUSD = Math.abs(parseFloat(swap.amountUSD));
        } else {
            continue;
        }

        const feeRate = parseInt(swap.pool?.feeTier || '3000') / 1000000;
        const feesUSD = volumeUSD * feeRate;

        dailyData[dateKey].volume += volumeUSD;
        dailyData[dateKey].fees += feesUSD;
    }

    return Object.values(dailyData);
}

function aggregateWeekly(dailyData) {
    const weekly = {};

    for (const day of dailyData) {
        const date = new Date(day.timestamp * 1000);
        const dayOfWeek = date.getUTCDay();
        const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        const monday = new Date(date);
        monday.setUTCDate(date.getUTCDate() + diff);
        monday.setUTCHours(0, 0, 0, 0);

        const key = monday.toISOString().split('T')[0];

        if (!weekly[key]) {
            weekly[key] = { date: key, volume: 0, fees: 0 };
        }

        weekly[key].volume += day.volume;
        weekly[key].fees += day.fees;
    }

    return Object.values(weekly).sort((a, b) =>
        a.date.localeCompare(b.date)
    );
}

function calculateTotalVolume(dailyData) {
    return dailyData.reduce((sum, day) => sum + day.volume, 0);
}

async function main() {
    const startTime = Date.now();

    console.log('Starting SUPER-OPTIMIZED Uniswap V4 data fetch...\n');
    console.log(`Fetching data from last 8 weeks (since ${new Date(START_TIMESTAMP * 1000).toISOString()})\n`);
    console.log(`Processing ${CHAINS.length} chains in parallel (${MAX_CONCURRENT_BATCHES} concurrent batches per chain)...\n`);

    const output = {
        chains: {},
        poolMetadata: {},
        lastUpdated: new Date().toISOString(),
    };

    const progress = {
        total: CHAINS.length,
        completed: 0,
        successful: 0,
        failed: 0
    };

    // Process all chains in parallel
    const chainPromises = CHAINS.map(async (chain) => {
        const chainStart = Date.now();

        try {
            const pool = await fetchPoolDetails(chain);

            if (!pool) {
                progress.completed++;
                progress.failed++;
                console.log(`[${progress.completed}/${progress.total}] ${chain.name}: Pool not found`);
                return { chain: chain.name, success: false };
            }

            const swaps = await fetchPoolSwapsSuperFast(chain, pool.id);

            if (swaps.length === 0) {
                progress.completed++;
                progress.failed++;
                console.log(`[${progress.completed}/${progress.total}] ${chain.name}: No swaps in time range`);
                return { chain: chain.name, success: false };
            }

            const dailyData = calculateVolumeAndFees(swaps);
            const totalVolume = calculateTotalVolume(dailyData);
            const weeklyData = aggregateWeekly(dailyData);

            const poolMetadata = {
                poolId: pool.id,
                pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
                feeTier: pool.feeTier,
                feePercent: (parseInt(pool.feeTier) / 10000).toFixed(6) + '%',
            };

            const chainTime = ((Date.now() - chainStart) / 1000).toFixed(1);
            progress.completed++;
            progress.successful++;

            console.log(`✅ [${progress.completed}/${progress.total}] ${chain.name}: ${pool.token0.symbol}/${pool.token1.symbol} - ${swaps.length} swaps, $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${chainTime}s)`);

            return {
                chain: chain.name,
                success: true,
                poolMetadata,
                weeklyData
            };
        } catch (error) {
            progress.completed++;
            progress.failed++;
            console.error(`❌ [${progress.completed}/${progress.total}] ${chain.name}: ${error.message}`);
            return { chain: chain.name, success: false };
        }
    });

    const results = await Promise.all(chainPromises);

    results.forEach(result => {
        if (result.success) {
            output.chains[result.chain] = result.weeklyData;
            output.poolMetadata[result.chain] = result.poolMetadata;
        }
    });

    const outDir = path.join(__dirname, '../public');
    const outPath = path.join(outDir, 'uniswap_data.json');

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Complete! Data saved to: ${outPath}`);
    console.log(`Results: ${progress.successful} successful, ${progress.failed} failed`);
    console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
});