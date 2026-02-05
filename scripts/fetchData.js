import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUERY = `
{
  uniswapDayDatas(first: 365, orderBy: date, orderDirection: desc) {
    date
    volumeUSD
    feesUSD
  }
}
`;

async function fetchChainData(chainName, url) {
    console.log(`Fetching ${chainName}...`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: QUERY }),
        });

        const result = await response.json();
        if (result.errors || !result.data) {
            throw new Error(result.errors ? JSON.stringify(result.errors) : 'No data found');
        }
        return result.data.uniswapDayDatas;
    } catch (error) {
        console.warn(`⚠️ Failed to fetch ${chainName}: ${error.message}`);
        return generateMockData();
    }
}

function generateMockData() {
    const data = [];
    const now = new Date();
    for (let i = 0; i < 365; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const growthFactor = 1 - (i / 365);
        const randomVar = 0.5 + Math.random();
        data.push({
            date: Math.floor(date.getTime() / 1000),
            volumeUSD: (50000000 * growthFactor * randomVar).toFixed(2),
            feesUSD: (50000 * growthFactor * randomVar).toFixed(2)
        });
    }
    return data;
}

function processChainData(dayDatas) {
    const monthlyData = {};

    dayDatas.forEach(day => {
        const date = new Date(day.date * 1000);
        // Use UTC to avoid timezone shifting issues on boundaries
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const monthKey = `${year}-${month}`;

        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = {
                volume: 0,
                fees: 0,
                date: monthKey
            };
        }

        monthlyData[monthKey].volume += parseFloat(day.volumeUSD);
        monthlyData[monthKey].fees += parseFloat(day.feesUSD);
    });

    return Object.values(monthlyData).sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
    const chains = {};

    // Find all V4_SUBGRAPH_URL_* variables
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('V4_SUBGRAPH_URL_')) {
            const chainName = key.replace('V4_SUBGRAPH_URL_', '');
            chains[chainName] = value;
        }
    }

    // Fallback if no env vars found
    if (Object.keys(chains).length === 0) {
        console.log('No chains found in .env, using default placeholder');
        chains['MAINNET'] = 'https://api.studio.thegraph.com/query/UNI_V4_PLACEHOLDER';
    }

    const finalData = {
        chains: {},
        lastUpdated: new Date().toISOString()
    };

    for (const [name, url] of Object.entries(chains)) {
        const rawData = await fetchChainData(name, url);
        finalData.chains[name] = processChainData(rawData);
    }

    const outputPath = path.join(__dirname, '../public/uniswap_data.json');
    fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));

    console.log(`✅ Data saved to ${outputPath}`);
}

main();
