// Netlify Edge Function for manually updating trade PnL data from Bybit API
import { createClient } from '@supabase/supabase-js';
import { MAINNET_URL, TESTNET_URL } from './utils/bybit.edge.mjs';

// CORS headers to include in all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Maximum number of API call retries
const MAX_RETRIES = 3;

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

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to find the best matching PnL record
function findBestMatchingPnl(trade, closedPnlList) {
  console.log(`Finding best PnL match for trade: Symbol=${trade.symbol}, Side=${trade.side}, Qty=${trade.quantity}, OrderID=${trade.order_id}`);
  
  // First try exact orderId match
  const exactMatch = closedPnlList.find(pnl => pnl.orderId === trade.order_id);
  if (exactMatch) {
    console.log(`Found exact order ID match: ${exactMatch.orderId}`);
    return { match: exactMatch, matchType: 'exact_order_id' };
  }
  
  console.log(`No exact order ID match found, trying alternative matching methods...`);
  
  // Filter by symbol
  const symbolMatches = closedPnlList.filter(pnl => pnl.symbol === trade.symbol);
  console.log(`Found ${symbolMatches.length} trades with matching symbol: ${trade.symbol}`);
  
  if (symbolMatches.length === 0) return { match: null, matchType: 'no_symbol_match' };
  
  // Filter by matching side 
  // Note: If trade.side = 'Buy', the closing side in Bybit would be 'Sell' and vice versa
  const oppositeSide = trade.side === 'Buy' ? 'Sell' : 'Buy';
  const sideMatches = symbolMatches.filter(pnl => pnl.side === oppositeSide);
  console.log(`Found ${sideMatches.length} trades with opposite side: ${oppositeSide}`);
  
  if (sideMatches.length === 0) {
    // If no opposite side matches, try with the same side as a fallback
    // This is because some API responses might report the original side, not the closing side
    console.log(`No opposite side matches, trying with same side: ${trade.side}`);
    const sameSideMatches = symbolMatches.filter(pnl => pnl.side === trade.side);
    if (sameSideMatches.length > 0) {
      console.log(`Found ${sameSideMatches.length} trades with same side: ${trade.side}`);
      
      // Sort by time closest to trade.created_at
      const tradeTime = new Date(trade.created_at).getTime();
      sameSideMatches.sort((a, b) => {
        const aTimeDiff = Math.abs(parseInt(a.createdTime) - tradeTime);
        const bTimeDiff = Math.abs(parseInt(b.createdTime) - tradeTime);
        return aTimeDiff - bTimeDiff;
      });
      
      console.log(`Best match by time with same side (${trade.side}): closedPnl=${sameSideMatches[0].closedPnl}, created=${new Date(parseInt(sameSideMatches[0].createdTime)).toISOString()}`);
      return { match: sameSideMatches[0], matchType: 'same_side_time_match' };
    }
    
    return { match: null, matchType: 'no_side_match' };
  }
  
  // Filter by quantity (if available)
  if (trade.quantity) {
    const qtyMatches = sideMatches.filter(pnl => {
      const pnlQty = parseFloat(pnl.qty);
      const tradeQty = trade.quantity;
      const qtyDiff = Math.abs(pnlQty - tradeQty);
      const qtyPct = qtyDiff / tradeQty;
      return qtyPct < 0.01; // 1% tolerance for quantity differences
    });
    
    console.log(`Found ${qtyMatches.length} trades with matching quantity (within 1%): ${trade.quantity}`);
    
    if (qtyMatches.length > 0) {
      // Sort by time closest to trade.created_at
      const tradeTime = new Date(trade.created_at).getTime();
      qtyMatches.sort((a, b) => {
        const aTimeDiff = Math.abs(parseInt(a.createdTime) - tradeTime);
        const bTimeDiff = Math.abs(parseInt(b.createdTime) - tradeTime);
        return aTimeDiff - bTimeDiff;
      });
      
      console.log(`Best match by quantity and time: closedPnl=${qtyMatches[0].closedPnl}, created=${new Date(parseInt(qtyMatches[0].createdTime)).toISOString()}`);
      return { match: qtyMatches[0], matchType: 'quantity_time_match' };
    }
  }
  
  // Final fallback - sort by time closest to trade.created_at
  const tradeTime = new Date(trade.created_at).getTime();
  sideMatches.sort((a, b) => {
    const aTimeDiff = Math.abs(parseInt(a.createdTime) - tradeTime);
    const bTimeDiff = Math.abs(parseInt(b.createdTime) - tradeTime);
    return aTimeDiff - bTimeDiff;
  });
  
  // Return the closest match by time
  console.log(`Best match by time only: closedPnl=${sideMatches[0].closedPnl}, created=${new Date(parseInt(sideMatches[0].createdTime)).toISOString()}`);
  return { match: sideMatches[0], matchType: 'time_match' };
}

export default async function handler(request, context) {
  console.log("Edge Function: manualUpdateTradePnl started");
  
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
    
    console.log(`Processing manual PnL update for trade ID: ${tradeId}`);
    
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
        'Failed to fetch trade data for manual PnL update',
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
    
    console.log(`Found trade: ${trade.symbol}, order_id: ${trade.order_id}, state: ${trade.state}, created_at: ${trade.created_at}`);
    
    // Unlike updateTradePnl, we're going to allow this for any trade (open or closed)
    // but we'll check if it's a test trade to handle appropriately
    
    // Get the appropriate API key for this bot
    let apiKeyQuery = supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', trade.user_id)
      .eq('exchange', 'bybit');
    
    if (trade.bots.api_key_id) {
      // If bot has specific API key, use that one
      apiKeyQuery = apiKeyQuery.eq('id', trade.bots.api_key_id);
    } else {
      // Otherwise, use the default API key
      apiKeyQuery = apiKeyQuery.eq('is_default', true);
    }
    
    const { data: apiKey, error: apiKeyError } = await apiKeyQuery.single();
    
    if (apiKeyError || !apiKey) {
      // If no specific key or default key found, try fetching any key
      const { data: fallbackKey, error: fallbackError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', trade.user_id)
        .eq('exchange', 'bybit')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      
      if (fallbackError || !fallbackKey) {
        console.error("API credentials not found:", apiKeyError);
        
        await logEvent(
          supabase,
          'error',
          'API credentials not found for manual PnL update',
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
      
      // Use fallback key
      console.log(`Using fallback API key: ${fallbackKey.name}`);
      apiKey = fallbackKey;
    } else {
      console.log(`Using API key: ${apiKey.name} (${apiKey.account_type})`);
    }
    
    // If it's a test trade, generate a simulated PnL value
    if (trade.bots.test_mode) {
      console.log("Test mode enabled, using simulated PnL data");
      
      // Generate a simulated PnL
      const simulatedPriceMove = (Math.random() * 4) - 2; // -2% to 2%
      const baseAmount = trade.price * trade.quantity;
      let simulatedPnl = 0;
      
      if (trade.side === 'Buy') {
        simulatedPnl = baseAmount * (simulatedPriceMove / 100);
      } else {
        simulatedPnl = baseAmount * (-simulatedPriceMove / 100);
      }
      
      // Simulate fees (typically 0.06% of trade value)
      const fees = baseAmount * 0.0006;
      simulatedPnl = simulatedPnl - fees;
      
      // Simulate exit price
      const exitPrice = trade.price * (1 + (trade.side === 'Buy' ? simulatedPriceMove : -simulatedPriceMove) / 100);
      
      // Update the trade
      const { error: updateError } = await supabase
        .from('trades')
        .update({
          realized_pnl: simulatedPnl,
          exit_price: exitPrice,
          fees: fees,
          state: 'closed',
          close_reason: 'manual_update',
          updated_at: new Date().toISOString()
        })
        .eq('id', tradeId);
      
      if (updateError) {
        console.error("Error updating test trade with simulated PnL:", updateError);
        
        await logEvent(
          supabase,
          'error',
          'Failed to update test trade with simulated PnL',
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
      
      // Update bot's profit/loss
      const { error: botUpdateError } = await supabase
        .from('bots')
        .update({
          profit_loss: (trade.bots.profit_loss || 0) + simulatedPnl,
          updated_at: new Date().toISOString()
        })
        .eq('id', trade.bot_id);
      
      if (botUpdateError) {
        console.error("Error updating bot's profit/loss:", botUpdateError);
      }
      
      await logEvent(
        supabase,
        'info',
        'Manually updated test trade with simulated PnL data',
        { 
          trade_id: tradeId,
          realized_pnl: simulatedPnl,
          test_mode: true 
        },
        tradeId,
        trade.bot_id,
        trade.user_id
      );
      
      return new Response(
        JSON.stringify({ 
          success: true,
          message: "Manually updated test trade with simulated PnL",
          trade_id: tradeId,
          realized_pnl: simulatedPnl,
          exit_price: exitPrice,
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
    
    // For real trades, call Bybit API to get PnL data
    
    // Prepare to call Bybit API for closed PnL
    const baseUrl = trade.bots.test_mode ? TESTNET_URL : MAINNET_URL;
    
    // Choose the endpoint based on account type
    let endpoint = '/v5/position/closed-pnl';
    
    // Log account type explicitly
    console.log(`Using account type: ${apiKey.account_type || 'main'}`);
    
    // Implement retry logic with exponential backoff
    let attempts = 0;
    let bybitApiData = null;
    
    while (attempts < MAX_RETRIES) {
      try {
        // Signature components
        const timestamp = String(Date.now());
        const recvWindow = '5000';
        
        // Calculate the time range for fallback matching
        // Use a much wider time window of 24 hours to increase chances of finding the trade
        const tradeTime = new Date(trade.created_at).getTime();
        const startTime = tradeTime - (24 * 3600 * 1000); // 24 hours before
        const endTime = tradeTime + (24 * 3600 * 1000); // 24 hours after
        
        console.log(`Time range for PnL search: 
          Trade time: ${new Date(tradeTime).toISOString()}
          Start time: ${new Date(startTime).toISOString()} 
          End time: ${new Date(endTime).toISOString()}`
        );
        
        // Parameters for Bybit API call
        const params = new URLSearchParams({
          category: 'linear',
          symbol: trade.symbol,
          limit: '100',  // Increased limit to find more potential matches
          startTime: startTime.toString(),
          endTime: endTime.toString(),
          timestamp,
          recv_window: recvWindow
        });
        
        // Add sub-account parameter if needed
        if (apiKey.account_type === 'sub') {
          // This is where you'd add any specific parameters for sub-accounts
          // Example: params.append('subAccountId', 'your-sub-account-id');
          console.log('Using sub-account API configuration');
        }
        
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
        const apiUrl = `${baseUrl}${endpoint}?${params.toString()}`;
        console.log(`Calling Bybit API: ${apiUrl}`);
        
        const response = await fetch(apiUrl, {
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
          throw new Error(`HTTP error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        
        if (data.retCode !== 0) {
          console.error(`Bybit API error: ${data.retMsg}`);
          throw new Error(`Bybit API error: ${data.retMsg}`);
        }
        
        console.log(`Bybit API response: retCode=${data.retCode}, retMsg=${data.retMsg}, list length=${data.result.list.length}`);
        
        // Log detailed response for debugging
        await logEvent(
          supabase,
          'info',
          'Bybit closed PnL API response',
          { 
            side: trade.side,
            symbol: trade.symbol,
            order_id: trade.order_id,
            trade_id: tradeId,
            bybit_response: data
          },
          tradeId,
          trade.bot_id,
          trade.user_id
        );
        
        bybitApiData = data;
        break; // Success - exit retry loop
        
      } catch (error) {
        attempts++;
        console.error(`API call attempt ${attempts} failed:`, error);
        
        if (attempts >= MAX_RETRIES) {
          await logEvent(
            supabase,
            'error',
            'Failed to fetch closed PnL from Bybit API after multiple attempts',
            { 
              error: error.message,
              attempts,
              trade_id: tradeId
            },
            tradeId,
            trade.bot_id,
            trade.user_id
          );
          throw error;
        }
        
        // Exponential backoff with jitter
        const backoffTime = Math.min(1000 * Math.pow(2, attempts), 8000) + Math.random() * 1000;
        console.log(`Retrying in ${Math.round(backoffTime)}ms...`);
        await sleep(backoffTime);
      }
    }
    
    // Now we have the API data, find the matching trade
    const closedPnlList = bybitApiData.result.list || [];
    console.log(`Found ${closedPnlList.length} closed PnL records from Bybit API`);
    
    // Log PnL records for debugging
    console.log("Available closed PnL records:");
    closedPnlList.forEach((pnl, index) => {
      console.log(`[${index}] symbol=${pnl.symbol}, side=${pnl.side}, orderId=${pnl.orderId}, qty=${pnl.qty}, closedPnl=${pnl.closedPnl}, created=${new Date(parseInt(pnl.createdTime)).toISOString()}`);
    });
    
    const { match: matchingPnl, matchType } = findBestMatchingPnl(trade, closedPnlList);
    
    if (!matchingPnl) {
      console.log(`No matching closed PnL found for trade ${tradeId}`);
      
      await logEvent(
        supabase,
        'warning',
        'No matching closed PnL found in Bybit API response',
        { 
          order_id: trade.order_id,
          symbol: trade.symbol,
          side: trade.side,
          bybit_response: bybitApiData,
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
    
    console.log(`Found matching PnL record (${matchType}): ${JSON.stringify(matchingPnl)}`);
    
    // Extract PnL data
    const realizedPnl = parseFloat(matchingPnl.closedPnl);
    const avgEntryPrice = parseFloat(matchingPnl.avgEntryPrice);
    const avgExitPrice = parseFloat(matchingPnl.avgExitPrice);
    const cumEntryValue = parseFloat(matchingPnl.cumEntryValue || 0);
    const cumExitValue = parseFloat(matchingPnl.cumExitValue || 0);
    
    // Calculate additional metrics if needed
    const fees = cumExitValue * 0.0006; // Approximate fee calculation (0.06%)
    
    // Update the trade with PnL data and set state to closed
    const { error: updateError } = await supabase
      .from('trades')
      .update({
        realized_pnl: realizedPnl,
        avg_entry_price: avgEntryPrice,
        avg_exit_price: avgExitPrice,
        fees: fees,
        state: 'closed',
        close_reason: 'manual_update',
        details: {
          ...matchingPnl,
          pnl_match_type: matchType
        },
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
        avg_exit_price: avgExitPrice,
        match_type: matchType,
        manual: true
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
        avg_exit_price: avgExitPrice,
        match_type: matchType
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
        'Critical error manually updating trade PnL',
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
