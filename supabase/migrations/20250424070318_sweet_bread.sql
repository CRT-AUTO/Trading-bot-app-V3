/*
  # Add logs table for webhook execution tracking

  1. New Tables
    - `logs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key)
      - `bot_id` (uuid, foreign key, nullable)
      - `webhook_id` (uuid, foreign key, nullable)
      - `level` (text - 'info', 'warning', 'error')
      - `message` (text)
      - `details` (jsonb - for request/response/error details)
      - `created_at` (timestamp)
      
  2. Security
    - Enable RLS on logs table
    - Add policy for users to read their own logs
*/

-- Create logs table
CREATE TABLE IF NOT EXISTS logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES bots(id) ON DELETE SET NULL,
  webhook_id uuid REFERENCES webhooks(id) ON DELETE SET NULL,
  level text NOT NULL,
  message text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable row level security
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read own logs"
  ON logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role to insert logs
CREATE POLICY "Service role can create logs"
  ON logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);