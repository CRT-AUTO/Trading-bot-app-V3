// Position sizing utility functions for edge functions

/**
 * Calculates the appropriate position size based on risk parameters and price data.
 * 
 * @param {Object} params - Position sizing parameters
 * @param {number} params.entryPrice - Entry price for the trade
 * @param {number} params.stopLoss - Stop loss level for the trade
 * @param {number} params.riskAmount - Amount to risk in base currency (USDT)
 * @param {string} params.side - Trade direction ('Buy' or 'Sell')
 * @param {number} params.feePercentage - Trading fee percentage as a decimal (e.g., 0.075 for 0.075%)
 * @param {number} params.minQty - Minimum order quantity allowed by the exchange
 * @param {number} params.qtyStep - Quantity step size allowed by the exchange
 * @param {number} params.maxPositionSize - Maximum position size allowed (optional)
 * @param {number} params.decimals - Number of decimal places to round quantity to
 * 
 * @returns {number} - Calculated position size
 */
export function calculatePositionSize({
  entryPrice,
  stopLoss,
  riskAmount,
  side,
  feePercentage,
  minQty,
  qtyStep,
  maxPositionSize = 0,
  decimals = 8
}) {
  // Input validation
  if (!entryPrice || entryPrice <= 0) {
    throw new Error('Entry price must be a positive number');
  }
  if (!stopLoss || stopLoss <= 0) {
    throw new Error('Stop loss must be a positive number');
  }
  if (!riskAmount || riskAmount <= 0) {
    throw new Error('Risk amount must be a positive number');
  }
  if (side !== 'Buy' && side !== 'Sell') {
    throw new Error('Side must be "Buy" or "Sell"');
  }
  
  console.log(`Calculating position size with params: entryPrice=${entryPrice}, stopLoss=${stopLoss}, riskAmount=${riskAmount}, side=${side}, feePercentage=${feePercentage}, minQty=${minQty}, qtyStep=${qtyStep}, maxPositionSize=${maxPositionSize}`);

  // Calculate risk per unit (absolute difference)
  let riskPerUnit;
  if (side === 'Buy') {
    // For long positions: entry - stop loss
    if (entryPrice <= stopLoss) {
      throw new Error('Stop loss must be below entry price for Buy orders');
    }
    riskPerUnit = entryPrice - stopLoss;
  } else {
    // For short positions: stop loss - entry
    if (stopLoss <= entryPrice) {
      throw new Error('Stop loss must be above entry price for Sell orders');
    }
    riskPerUnit = stopLoss - entryPrice;
  }

  // Calculate entry and exit fees
  const entryFee = feePercentage / 100; // Convert to decimal (e.g., 0.075% -> 0.00075)
  const exitFee = feePercentage / 100;
  
  // Add fee cost to risk calculation
  // For a position size of X, we pay:
  // - Entry fee: X * entryPrice * entryFee
  // - Exit fee: X * exitPrice * exitFee (where exitPrice is approximately stopLoss)
  
  // The total additional cost due to fees is approximately:
  // X * entryPrice * entryFee + X * stopLoss * exitFee
  
  // Factor this into our risk calculation
  const totalFeeRateFactor = (entryPrice * entryFee + stopLoss * exitFee) / entryPrice;
  
  // Calculate raw position size: risk amount / (risk per unit + fees)
  let positionSize = riskAmount / (riskPerUnit + (entryPrice * totalFeeRateFactor));
  
  console.log(`Raw calculated position: riskPerUnit=${riskPerUnit}, totalFeeRateFactor=${totalFeeRateFactor}, position=${positionSize}`);
  
  // Convert to quantity
  let quantity = positionSize / entryPrice;
  
  // Check minimum quantity
  if (quantity < minQty) {
    console.log(`Calculated quantity ${quantity} is below minimum ${minQty}, using minimum`);
    quantity = minQty;
  }
  
  // Round down to the nearest step size
  if (qtyStep > 0) {
    quantity = Math.floor(quantity / qtyStep) * qtyStep;
    console.log(`Rounded quantity to step size (${qtyStep}): ${quantity}`);
  }
  
  // Ensure we don't exceed max position size if specified
  if (maxPositionSize > 0) {
    const positionValueUSDT = quantity * entryPrice;
    if (positionValueUSDT > maxPositionSize) {
      quantity = (maxPositionSize / entryPrice);
      // Round down to the nearest step size again
      if (qtyStep > 0) {
        quantity = Math.floor(quantity / qtyStep) * qtyStep;
      }
      console.log(`Reduced quantity to respect max position size (${maxPositionSize}): ${quantity}`);
    }
  }
  
  // Final rounding to the correct number of decimal places
  quantity = parseFloat(quantity.toFixed(decimals));
  
  // Calculate actual risk with the adjusted quantity
  const actualRisk = (quantity * riskPerUnit) + (quantity * entryPrice * entryFee) + (quantity * stopLoss * exitFee);
  console.log(`Final quantity: ${quantity}, Actual risk: ${actualRisk.toFixed(2)} USDT (target: ${riskAmount} USDT)`);
  
  return quantity;
}
