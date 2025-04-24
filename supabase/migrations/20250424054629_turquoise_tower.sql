/*
  # Add risk management columns to bots table

  1. New Columns
     - `daily_loss_limit` (numeric): Maximum amount a bot can lose in one day
     - `max_position_size` (numeric): Maximum position size for a single trade
  
  2. Purpose
     - Enhance risk management capabilities for trading bots
     - Allow users to set limits on potential losses
     - Enable position size restrictions for better risk control
*/

-- Add columns to bots table if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bots' AND column_name = 'daily_loss_limit'
  ) THEN
    ALTER TABLE bots ADD COLUMN daily_loss_limit numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bots' AND column_name = 'max_position_size'
  ) THEN
    ALTER TABLE bots ADD COLUMN max_position_size numeric;
  END IF;
END $$;