// Netlify Edge Function for updating trade PnL data from Bybit API
import { createClient } from '@supabase/supabase-js';
import { MAINNET_URL, TESTNET_URL } from './utils/bybit.edge.mjs';

// CORS headers to include in all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Helper function to log events to the database
async function logEvent(supabase, level, message, details, tradeId = null, botId = null, userId = null) {
  try {
    const { error } = await supabase
      .from('logs')
      .insert({
        level,
        message,
        details,
        trade_id: tradeId,
        bot_id: botId,
        user_id: userId,
        created_at: new Date().toISOString()
      });
      
    if (error) {
      console.error('Error logging event:', error);
    }
  } catch (e) {
    console.error('Exception logging event:', e);
  }
}

export default async function handler(request, context) {
  console.log("Edge Function: updateTradePnl started");
  
  // Handle preflight requests
  if (request.method === "OPTIONS") {
    console.log("Handling preflight request");
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Only allow POST requests
  if (request.method !== "POST") {
    console.log(`Invalid request method: ${request.method}`);
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }

  // Get environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_KEY');
  
  console.log(`Environment check: SUPABASE_URL=${!!supabaseUrl}, SERVICE_KEY=${!!supabaseServiceKey}`);
  
  // Check if environment variables are set
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase environment variables");
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  console.log("Supabase client initialized");

  try {
    // Parse request body
    const body = await request.json();
    const { tradeId } = body;
    
    console.log(`Processing PnL update for trade ID: ${tradeId}`);
    
    if (!tradeId) {
      console.error("Missing trade ID in request");
      return new Response(
        JSON.stringify({ error: "Missing trade ID" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    // Get trade details
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, bots:bot_id(*)')
      .eq('id', tradeId)
      .single();
      
    if (tradeError || !trade) {
      console.error("Error fetching trade:", tradeError);
      
      await logEvent(
        supabase,
        'error',
        'Failed to fetch trade data for PnL update',
        { error: tradeError, trade_id: tradeId }
      );
      
      return new Response(
        JSON.stringify({ error: "Trade not found" }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    console.log(`Found trade: ${trade.symbol}, order_id: ${trade.order_id}`);
    
    // Skip if already has realized PnL and it's not a test trade
    if (trade.realized_pnl !== null && !trade.bots.test_mode) {
      console.log(`Trade ${tradeId} already has realized PnL: ${trade.realized_pnl}`);
      
      await logEvent(
        supabase,
        'info',
        'Trade already has PnL data, skipping update',
        { trade_id: tradeId, realized_pnl: trade.realized_pnl },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Trade already has PnL data",
          trade_id: tradeId,
          realized_pnl: trade.realized_pnl 
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    // Get API credentials
    const { data: apiKey, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', trade.user_id)
      .eq('exchange', 'bybit')
      .single();
      
    if (apiKeyError || !apiKey) {
      console.error("API credentials not found:", apiKeyError);
      
      await logEvent(
        supabase,
        'error',
        'API credentials not found for PnL update',
        { error: apiKeyError },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      return new Response(
        JSON.stringify({ error: "API credentials not found" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    // If it's a test trade, we don't call the Bybit API
    if (trade.bots.test_mode) {
      console.log("Test mode enabled, using simulated PnL data");
      
      // The realized PnL should already be calculated in processAlert.edge.js for test trades
      // We just log that we're using the simulation data
      await logEvent(
        supabase,
        'info',
        'Using simulated PnL data for test trade',
        { 
          trade_id: tradeId,
          realized_pnl: trade.realized_pnl,
          test_mode: true 
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Using simulated PnL data for test trade",
          trade_id: tradeId,
          realized_pnl: trade.realized_pnl,
          test_mode: true
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    // Prepare to call Bybit API for closed PnL
    const baseUrl = trade.bots.test_mode ? TESTNET_URL : MAINNET_URL;
    const endpoint = '/v5/position/closed-pnl';
    
    // Signature components
    const timestamp = String(Date.now());
    const recvWindow = '5000';
    
    // Parameters for Bybit API call
    const params = new URLSearchParams({
      category: 'linear',
      symbol: trade.symbol,
      limit: '50',  // Request more to ensure we find our order
      timestamp,
      recv_window: recvWindow
    });
    
    // Generate HMAC SHA256 signature
    const signatureMessage = timestamp + apiKey.api_key + recvWindow + params.toString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiKey.api_secret);
    const messageData = encoder.encode(signatureMessage);
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    const signatureHex = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Call Bybit API
    console.log(`Calling Bybit API: ${baseUrl}${endpoint}?${params.toString()}`);
    const response = await fetch(`${baseUrl}${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey.api_key,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signatureHex
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP error: ${response.status} - ${errorText}`);
      
      await logEvent(
        supabase,
        'error',
        'Failed to fetch closed PnL from Bybit API',
        { 
          status: response.status,
          error: errorText,
          trade_id: tradeId
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      throw new Error(`HTTP error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (data.retCode !== 0) {
      console.error(`Bybit API error: ${data.retMsg}`);
      
      await logEvent(
        supabase,
        'error',
        'Bybit API returned an error',
        { 
          retCode: data.retCode,
          retMsg: data.retMsg,
          trade_id: tradeId
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
    
    console.log('Bybit API response:', JSON.stringify(data));
    
    // Find the matching trade in closed PnL records
    const closedPnlList = data.result.list || [];
    const matchingPnl = closedPnlList.find(pnl => pnl.orderId === trade.order_id);
    
    if (!matchingPnl) {
      console.log(`No matching closed PnL found for order ID: ${trade.order_id}`);
      
      await logEvent(
        supabase,
        'warning',
        'No matching closed PnL found in Bybit API response',
        { 
          order_id: trade.order_id,
          bybit_response: data,
          trade_id: tradeId
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      return new Response(
        JSON.stringify({ 
          success: false,
          message: "No matching closed PnL found",
          trade_id: tradeId
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    console.log(`Found matching PnL record: ${JSON.stringify(matchingPnl)}`);
    
    // Extract PnL data
    const realizedPnl = parseFloat(matchingPnl.closedPnl);
    const avgEntryPrice = parseFloat(matchingPnl.avgEntryPrice);
    const avgExitPrice = parseFloat(matchingPnl.avgExitPrice);
    
    // Update the trade with PnL data
    const { error: updateError } = await supabase
      .from('trades')
      .update({
        realized_pnl: realizedPnl,
        avg_entry_price: avgEntryPrice,
        avg_exit_price: avgExitPrice,
        details: matchingPnl,
        updated_at: new Date().toISOString()
      })
      .eq('id', tradeId);
    
    if (updateError) {
      console.error("Error updating trade with PnL data:", updateError);
      
      await logEvent(
        supabase,
        'error',
        'Failed to update trade with PnL data',
        { 
          error: updateError,
          trade_id: tradeId
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      throw updateError;
    }
    
    console.log(`Successfully updated trade ${tradeId} with realized PnL: ${realizedPnl}`);
    
    // Update bot's profit/loss
    const { error: botUpdateError } = await supabase
      .from('bots')
      .update({
        profit_loss: (trade.bots.profit_loss || 0) + realizedPnl,
        updated_at: new Date().toISOString()
      })
      .eq('id', trade.bot_id);
    
    if (botUpdateError) {
      console.error("Error updating bot's profit/loss:", botUpdateError);
      
      await logEvent(
        supabase,
        'error',
        'Failed to update bot profit/loss',
        { 
          error: botUpdateError,
          bot_id: trade.bot_id,
          realized_pnl: realizedPnl
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
    }
    
    await logEvent(
      supabase,
      'info',
      'Successfully updated trade with PnL data from Bybit API',
      { 
        trade_id: tradeId,
        realized_pnl: realizedPnl,
        avg_entry_price: avgEntryPrice,
        avg_exit_price: avgExitPrice
      },
      tradeId,
      trade.bot_id,
      trade.user_id
    );
    
    return new Response(
      JSON.stringify({ 
        success: true,
        trade_id: tradeId,
        realized_pnl: realizedPnl,
        avg_entry_price: avgEntryPrice,
        avg_exit_price: avgExitPrice
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
    
  } catch (error) {
    console.error('Error updating trade PnL:', error);
    
    // Try to log the error even if we don't have specific trade details
    try {
      await logEvent(
        supabase,
        'error',
        'Critical error updating trade PnL',
        { error: error.message }
      );
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
}
