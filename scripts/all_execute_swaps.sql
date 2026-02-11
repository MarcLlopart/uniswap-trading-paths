WITH decoded_data AS (
  SELECT
    -- Extract deadline
    TRY_CAST(
      from_big_endian_64(bytearray_substring(data, 5 + 32*2 + 24, 8))
      AS BIGINT
    ) AS deadline_timestamp,
    
    -- Extract token addresses (last 20 bytes of word)
    bytearray_substring(data, 5 + 32*18 + 12, 20) AS token_from,
    bytearray_substring(data, 5 + 32*19 + 12, 20) AS token_to,
    
    -- Extract fee tier
    TRY_CAST(
      from_big_endian_32(bytearray_substring(data, 5 + 32*20 + 28, 4))
      AS INTEGER
    ) AS fee_tier_raw,
    
    -- Extract amounts
    TRY_CAST(
      from_big_endian_64(bytearray_substring(data, 5 + 32*24 + 24, 8))
      AS DECIMAL(38,0)
    ) AS amount_in_raw,
    
    TRY_CAST(
      from_big_endian_64(bytearray_substring(data, 5 + 32*25 + 24, 8))
      AS DECIMAL(38,0)
    ) AS amount_out_min_raw,
    
    hash
  FROM unichain.transactions
  WHERE 
    to = 0xEf740bf23aCaE26f6492B10de645D6B98dC8Eaf3 -- Uniswap Universal Router
    AND bytearray_substring(data, 1, 4) = from_hex('3593564c') -- execute() method
    AND length(data) >= (5 + 32*26) -- Ensure data is long enough 
    AND block_time >= TIMESTAMP '2026-02-01' -- Adjust date range as needed
),

token_info AS (
  SELECT
    d.*,
    t_from.symbol AS token_from_symbol,
    t_from.decimals AS token_from_decimals,
    t_to.symbol AS token_to_symbol,
    t_to.decimals AS token_to_decimals
  FROM decoded_data d
  LEFT JOIN tokens.erc20 t_from
    ON t_from.blockchain = 'unichain'
    AND t_from.contract_address = d.token_from
  LEFT JOIN tokens.erc20 t_to
    ON t_to.blockchain = 'unichain'
    AND t_to.contract_address = d.token_to
)

SELECT
  hash,
  from_unixtime(deadline_timestamp) AS deadline,
  token_from AS token_from_address,
  token_from_symbol,
  token_from_decimals,
  CAST(amount_in_raw AS DOUBLE) / POW(10, COALESCE(token_from_decimals, 18)) AS amount_in,
  token_to AS token_to_address,
  token_to_symbol,
  token_to_decimals,
  CAST(amount_out_min_raw AS DOUBLE) / POW(10, COALESCE(token_to_decimals, 18)) AS amount_out_min,
  fee_tier_raw,
  CAST(fee_tier_raw AS DOUBLE) / 1000000 AS fee_tier_decimal,
  COALESCE(token_from_symbol, 'UNKNOWN') || ' → ' || COALESCE(token_to_symbol, 'UNKNOWN') AS swap_pair,
  amount_in_raw,
  amount_out_min_raw

FROM token_info
WHERE fee_tier_raw IS NOT NULL 
ORDER BY block_time DESC
LIMIT 100;