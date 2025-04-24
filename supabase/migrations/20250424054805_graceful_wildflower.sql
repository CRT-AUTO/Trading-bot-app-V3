/*
  # Add PnL columns to trades table

  1. New Columns
     - `realized_pnl` (numeric): The realized profit/loss for closed trades
     - `unrealized_pnl` (numeric): The unrealized profit/loss for open trades
     - `fees` (numeric): Trading fees incurred
     - `slippage` (numeric): Price slippage experienced during execution
  
  2. Purpose
     - Enable tracking of trade performance metrics
     - Allow for accurate calculation of bot profitability
     - Support advanced analytics features
*/

-- Add columns to trades table if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'realized_pnl'
  ) THEN
    ALTER TABLE trades ADD COLUMN realized_pnl numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'unrealized_pnl'
  ) THEN
    ALTER TABLE trades ADD COLUMN unrealized_pnl numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'fees'
  ) THEN
    ALTER TABLE trades ADD COLUMN fees numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'slippage'
  ) THEN
    ALTER TABLE trades ADD COLUMN slippage numeric DEFAULT 0;
  END IF;
END $$;