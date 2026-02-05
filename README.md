# Uniswap Trade Execution Paths

Complete Guide to Interaction Methods and Execution Flows

This document provides a clear, comprehensive breakdown of how trades execute on Uniswap across V2, V3, and V4. It groups interaction methods by execution path and provides technical walkthroughs of key flows.

## Table of Contents

- [All Interaction Methods](#all-interaction-methods)
- [Execution Path Groups](#execution-path-groups)
- [Technical Deep Dive: V2 Router](#technical-deep-dive-v2-router)
- [Technical Deep Dive: V3 Direct Pool](#technical-deep-dive-v3-direct-pool)
- [Volume & Fee Extraction](#volume--fee-extraction)
- [Dashboard Walkthrough](#dashboard-walkthrough)

---

## All Interaction Methods

Users can initiate trades through multiple entry points. Here's the complete list organized by version:

### Uniswap V2

- **Router02.swapExactTokensForTokens()** — Swap exact input for minimum output
- **Router02.swapTokensForExactTokens()** — Swap maximum input for exact output
- **Pair.swap()** — Direct pool interaction (advanced users)

### Uniswap V3

- **SwapRouter.exactInputSingle()** — Single-hop exact input
- **SwapRouter.exactInput()** — Multi-hop exact input with encoded path
- **SwapRouter.exactOutputSingle()** — Single-hop exact output
- **SwapRouter.exactOutput()** — Multi-hop exact output
- **Pool.swap()** — Direct pool interaction with callback (advanced users)

### Uniswap V4

- **PoolManager.swap()** — Direct singleton interaction with flash accounting
- **UniversalRouter.execute()** — Batched operations via command pattern
- **Custom hook integrations** — Hooks can modify swap behavior

---

## Execution Path Groups

Despite multiple entry points, all trades ultimately follow one of four core execution patterns. Understanding these patterns is essential for analytics, integrations, and optimization.

### Path A: Router Single-Hop

**Execution Flow:**
```
User → Router.swapExactTokensForTokens → Pair/Pool.swap() → Return to user
```

**Characteristics:**
- Router validates deadline and slippage tolerance
- Single pool interaction
- Gas cost: ~100k (V2), ~130k (V3)

**Applies to:**
- V2: Router02.swapExactTokensForTokens
- V3: SwapRouter.exactInputSingle

### Path B: Router Multi-Hop

**Execution Flow:**
```
User → Router → Pool₁ → Pool₂ → ... → Pool_n → Return to user
```

**Characteristics:**
- Router orchestrates multiple pool swaps
- Validates final output against amountOutMin
- Gas cost: ~170k for 2 hops (V2), ~230k (V3)

**Applies to:**
- V2: Router02.swapExactTokensForTokens with path.length > 2
- V3: SwapRouter.exactInput with encoded multi-hop path

### Path C: Direct Pool

**Execution Flow:**
```
User → Pool.swap() → [Callback for payment] → Return to user
```

**Characteristics:**
- Bypasses router entirely
- Caller must implement callback (V3) or handle payment logic (V2)
- No automatic slippage or deadline checks
- Gas savings: ~30-50k vs router

**Applies to:**
- V2: Pair.swap(amount0Out, amount1Out, to, data)
- V3: Pool.swap() with IUniswapV3SwapCallback

### Path D: V4 Singleton / Universal

**Execution Flow:**
```
User → PoolManager.unlock() → [Flash accounting] → Net settlement
```

**Characteristics:**
- All pools in singleton contract
- Flash accounting tracks deltas, settles net amounts
- Hooks can customize behavior at 10+ lifecycle points
- Gas savings: 40-60% vs V3 for multi-hop

**Applies to:**
- V4: PoolManager.swap() direct calls
- V4: UniversalRouter.execute() for batched operations

---

## Technical Deep Dive: V2 Router

This section provides a complete technical walkthrough of `Router02.swapExactTokensForTokens()`, covering calldata structure, function calls, and state changes.

### Prerequisites

1. User must approve Router02 to spend tokenIn
2. User constructs path array [tokenIn, ..., tokenOut]
3. User sets amountOutMin (slippage tolerance)

### Function Signature

```solidity
function swapExactTokensForTokens(
    uint amountIn,
    uint amountOutMin,
    address[] calldata path,
    address to,
    uint deadline
) external returns (uint[] memory amounts)
```

### Execution Steps

#### Step 1: Deadline Check

```solidity
require(block.timestamp <= deadline, 'UniswapV2Router: EXPIRED');
```

The router first validates that the transaction hasn't expired. This prevents stale transactions from executing at unfavorable prices.

#### Step 2: Calculate Expected Amounts

```solidity
amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
require(amounts[amounts.length - 1] >= amountOutMin, 'INSUFFICIENT_OUTPUT_AMOUNT');
```

`getAmountsOut()` calculates the expected output at each hop using the constant product formula. The final output is validated against the user's minimum.

#### Step 3: Transfer to First Pair

```solidity
TransferHelper.safeTransferFrom(
    path[0],
    msg.sender,
    UniswapV2Library.pairFor(factory, path[0], path[1]),
    amounts[0]
);
```

The router transfers tokenIn directly from the user to the first pair contract.

#### Step 4: Execute Swaps

```solidity
_swap(amounts, path, to);

// Internal _swap function iterates through path
function _swap(uint[] memory amounts, address[] memory path, address _to) internal {
    for (uint i; i < path.length - 1; i++) {
        (address input, address output) = (path[i], path[i + 1]);
        (address token0,) = UniswapV2Library.sortTokens(input, output);
        uint amountOut = amounts[i + 1];
        (uint amount0Out, uint amount1Out) = input == token0
            ? (uint(0), amountOut)
            : (amountOut, uint(0));
        address to = i < path.length - 2
            ? UniswapV2Library.pairFor(factory, output, path[i + 2])
            : _to;
        IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output)).swap(
            amount0Out, amount1Out, to, new bytes(0)
        );
    }
}
```

### Pair.swap() Internal Logic

```solidity
function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external {
    require(amount0Out > 0 || amount1Out > 0, 'INSUFFICIENT_OUTPUT_AMOUNT');
    (uint112 _reserve0, uint112 _reserve1,) = getReserves();
    require(amount0Out < _reserve0 && amount1Out < _reserve1, 'INSUFFICIENT_LIQUIDITY');

    // Optimistically transfer output tokens
    if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
    if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);

    // Check balances and validate k
    uint balance0 = IERC20(_token0).balanceOf(address(this));
    uint balance1 = IERC20(_token1).balanceOf(address(this));
    uint amount0In = balance0 > _reserve0 - amount0Out
        ? balance0 - (_reserve0 - amount0Out) : 0;
    uint amount1In = balance1 > _reserve1 - amount1Out
        ? balance1 - (_reserve1 - amount1Out) : 0;
    require(amount0In > 0 || amount1In > 0, 'INSUFFICIENT_INPUT_AMOUNT');

    // Verify constant product (with 0.3% fee)
    uint balance0Adjusted = balance0.mul(1000).sub(amount0In.mul(3));
    uint balance1Adjusted = balance1.mul(1000).sub(amount1In.mul(3));
    require(
        balance0Adjusted.mul(balance1Adjusted) >= uint(_reserve0).mul(_reserve1).mul(1000**2),
        'K'
    );

    _update(balance0, balance1, _reserve0, _reserve1);
    emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
}
```

### On-Chain State Changes

**Pair Contract Storage:**
- `reserve0` and `reserve1` updated to new balances
- `price0CumulativeLast` and `price1CumulativeLast` incremented (TWAP oracle)
- `blockTimestampLast` updated to current block
- `kLast` updated (for protocol fee calculation)

**Events Emitted:**

```solidity
event Swap(
    address indexed sender,
    uint amount0In,
    uint amount1In,
    uint amount0Out,
    uint amount1Out,
    address indexed to
);

event Sync(uint112 reserve0, uint112 reserve1);
```

---

## Technical Deep Dive: V3 Direct Pool

This section covers direct `Pool.swap()` calls in V3, including the callback pattern and optimistic transfer mechanism.

### Prerequisites

1. Caller must implement `IUniswapV3SwapCallback` interface
2. Caller must have approval to transfer tokens from payer
3. Caller is responsible for slippage and deadline checks

### Function Signature

```solidity
function swap(
    address recipient,
    bool zeroForOne,
    int256 amountSpecified,
    uint160 sqrtPriceLimitX96,
    bytes calldata data
) external returns (int256 amount0, int256 amount1)
```

### Execution Steps

#### Step 1: Load Pool State

```solidity
Slot0 memory slot0Start = slot0;
require(slot0Start.unlocked, 'LOK'); // Reentrancy protection
require(
    zeroForOne
        ? sqrtPriceLimitX96 < slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO
        : sqrtPriceLimitX96 > slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
    'SPL'
);
```

#### Step 2: Execute Swap Loop

```solidity
SwapState memory state = SwapState({
    amountSpecifiedRemaining: amountSpecified,
    amountCalculated: 0,
    sqrtPriceX96: slot0Start.sqrtPriceX96,
    tick: slot0Start.tick,
    liquidity: liquidity
});

// Loop through ticks until amount is satisfied or price limit is reached
while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96) {
    // Compute swap within current tick range
    // Cross ticks if needed
    // Update liquidity when crossing ticks
}
```

The swap logic iterates through price ticks, computing output amounts and updating state. When crossing tick boundaries, the pool updates active liquidity.

#### Step 3: Update Global State

```solidity
if (state.tick != slot0Start.tick) {
    (slot0.sqrtPriceX96, slot0.tick) = (state.sqrtPriceX96, state.tick);
} else {
    slot0.sqrtPriceX96 = state.sqrtPriceX96;
}
if (liquidity != state.liquidity) liquidity = state.liquidity;
```

#### Step 4: Optimistic Transfer

```solidity
if (amount0 < 0) TransferHelper.safeTransfer(token0, recipient, uint256(-amount0));
if (amount1 < 0) TransferHelper.safeTransfer(token1, recipient, uint256(-amount1));
```

The pool sends output tokens to the recipient BEFORE receiving payment. This is the 'optimistic transfer' that enables flash swaps.

#### Step 5: Invoke Callback

```solidity
if (amount0 > 0 || amount1 > 0) {
    IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
}
```

The pool calls back to msg.sender, passing the amounts owed. The caller MUST transfer the required tokens during this callback.

#### Step 6: Verify Payment

```solidity
uint256 balance0After = balance0();
uint256 balance1After = balance1();
require(
    balance0After >= uint256(balance0Before + amount0),
    'IIA' // Insufficient Input Amount
);
require(
    balance1After >= uint256(balance1Before + amount1),
    'IIA'
);
```

After the callback returns, the pool verifies that its balance increased by the expected amount. If not, the transaction reverts.

#### Step 7: Emit Event

```solidity
emit Swap(msg.sender, recipient, amount0, amount1, state.sqrtPriceX96, state.liquidity, state.tick);
```

### Callback Implementation Example

```solidity
function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
) external override {
    // CRITICAL: Verify caller is a valid pool
    require(msg.sender == pool, 'Unauthorized');

    // Decode callback data to get payer address
    address payer = abi.decode(data, (address));

    // Transfer owed tokens to pool
    if (amount0Delta > 0) {
        IERC20(token0).transferFrom(payer, msg.sender, uint256(amount0Delta));
    }
    if (amount1Delta > 0) {
        IERC20(token1).transferFrom(payer, msg.sender, uint256(amount1Delta));
    }
}
```

### On-Chain State Changes

**Pool Storage Updates:**
- `slot0.sqrtPriceX96` — Updated to new price after swap
- `slot0.tick` — Updated if price crossed tick boundaries
- `liquidity` — Active liquidity at new tick
- `feeGrowthGlobal0X128` / `feeGrowthGlobal1X128` — Accumulated fees for LPs
- `ticks[i].liquidityNet` — Updated when crossing tick i
- `observations[slot0.observationIndex]` — TWAP oracle data point

---

## Volume & Fee Extraction

Accurate analytics require understanding how different execution paths emit events and update state. Here's a practical guide to indexing volume and fees across all Uniswap versions.

### V2: Sync and Swap Events

**Event Structure:**

```solidity
event Sync(uint112 reserve0, uint112 reserve1);

event Swap(
    address indexed sender,
    uint amount0In,
    uint amount1In,
    uint amount0Out,
    uint amount1Out,
    address indexed to
);
```

**Indexing Strategy:**

```javascript
// Volume from Swap event
volumeToken0 = amount0In > 0 ? amount0In : amount0Out;
volumeToken1 = amount1In > 0 ? amount1In : amount1Out;

// Fee is always 0.3%
feeToken0 = volumeToken0 * 0.003;
feeToken1 = volumeToken1 * 0.003;

// Note: Sync event emits on EVERY state change
// Filter for Swap events to get actual trades
```

### V3: Swap Events

**Event Structure:**

```solidity
event Swap(
    address indexed sender,
    address indexed recipient,
    int256 amount0,
    int256 amount1,
    uint160 sqrtPriceX96,
    uint128 liquidity,
    int24 tick
);
```

**Indexing Strategy:**

```javascript
// Amounts are SIGNED: negative = sent to pool, positive = received from pool
volume = abs(amount0) + abs(amount1);

// Get fee tier from pool
feeTier = pool.fee(); // Returns 100, 500, 3000, or 10000
feeAmount = volume * feeTier / 1_000_000;

// For multi-hop: sum each leg separately, don't double-count
```

### V4: Swap Events

V4 uses a similar event structure to V3, but fees may be dynamic due to hook modifications.

```javascript
// Similar to V3
volume = abs(amount0) + abs(amount1);

// Fee may vary per swap if hooks override it
// Check event data or hook state for actual fee
feeAmount = volume * effectiveFee / 1_000_000;
```

### Common Pitfalls

- **Double-counting multi-hop swaps** — each hop emits a separate Swap event
- **V2 Sync events** fire on every state change, not just swaps
- **Failed transactions** don't emit events (V3/V4)
- **Token decimal normalization** is required for USD calculations
- **V4 hooks** can modify fees dynamically — must check actual fee used

### Dashboard Walkthrough
In order to run the dashboard you will need to get your API key from The Graph and add it to the .env file. The used subgraphs are on the .env-example file, you just need to copy the example file to .env and replace the API key with your own.

```bash
cp .env-example .env 
```

Once the .env file is ready, you can retrieve the data by running the following command:
```bash
npm run fetch-data
```

After the data is retrieved, you can run the dashboard by running the following command:
```bash
npm run dev
```
The dashboard will be available at http://localhost:5173


