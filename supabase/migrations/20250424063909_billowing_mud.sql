/*
  # Add stop_loss, take_profit, and state columns to trades table

  1. New Columns
    - `stop_loss` (numeric) - Stop loss price for the trade
    - `take_profit` (numeric) - Take profit price for the trade
    - `state` (text) - Trade state (open, closed)
    - `close_reason` (text) - Reason for trade closure (take_profit, stop_loss, manual, signal)

  2. Purpose
    - Store stop_loss and take_profit values with each trade for tracking
    - Track whether trades are open or closed
    - Track how trades were closed (via TP hit, SL hit, or manual/signal)
*/

-- Add columns to trades table if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'stop_loss'
  ) THEN
    ALTER TABLE trades ADD COLUMN stop_loss numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'take_profit'
  ) THEN
    ALTER TABLE trades ADD COLUMN take_profit numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'state'
  ) THEN
    ALTER TABLE trades ADD COLUMN state text DEFAULT 'open';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'close_reason'
  ) THEN
    ALTER TABLE trades ADD COLUMN close_reason text;
  END IF;
END $$;