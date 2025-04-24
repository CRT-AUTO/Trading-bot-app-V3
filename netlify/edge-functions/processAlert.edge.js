// Netlify Edge Function for processing TradingView alerts
import { createClient } from '@supabase/supabase-js';
import { executeBybitOrder, MAINNET_URL, TESTNET_URL } from './utils/bybit.edge.mjs';

// CORS headers to include in all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Helper function to log events to the database
async function logEvent(supabase, level, message, details, webhookId = null, botId = null, userId = null) {
  try {
    const { error } = await supabase
      .from('logs')
      .insert({
        level,
        message,
        details,
        webhook_id: webhookId,
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
  console.log("Edge Function: processAlert started");
  
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
    // Get webhook token from URL path
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const webhookToken = parts[parts.length - 1];
    
    console.log(`Processing webhook token: ${webhookToken}`);

    // Get request details for logging
    const headers = {};
    for (const [key, value] of request.headers.entries()) {
      headers[key] = value;
    }

    // Log webhook request
    await logEvent(
      supabase,
      'info',
      'Webhook request received',
      { 
        webhook_token: webhookToken,
        headers,
        url: request.url,
        method: request.method
      }
    );

    // Verify webhook token exists and is not expired
    const { data: webhook, error: webhookError } = await supabase
      .from('webhooks')
      .select('*, bots(*)')
      .eq('webhook_token', webhookToken)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (webhookError || !webhook) {
      console.error("Invalid/expired webhook:", webhookError);
      
      await logEvent(
        supabase,
        'error',
        'Invalid or expired webhook',
        { 
          webhook_token: webhookToken,
          error: webhookError 
        }
      );
      
      return new Response(
        JSON.stringify({ error: 'Invalid or expired webhook' }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Log webhook validated
    await logEvent(
      supabase,
      'info',
      'Webhook validated successfully',
      { webhook_id: webhook.id },
      webhook.id,
      webhook.bot_id,
      webhook.user_id
    );

    // Parse alert payload
    let alertData;
    let body;
    try { 
      body = await request.text();
      console.log('[processAlert.edge] Raw request body:', body);
      
      alertData = JSON.parse(body);
      console.log('[processAlert.edge] Parsed alert data:', alertData);
      
      await logEvent(
        supabase,
        'info',
        'Alert payload parsed successfully',
        { payload: alertData },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
    } catch (e) { 
      console.error("Alert JSON parse error:", e.message);
      
      await logEvent(
        supabase,
        'error',
        'Failed to parse alert JSON',
        { error: e.message, raw_body: body },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
      
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload', rawBody: body, headers }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Get the state from alert data (default to "open" if not provided)
    const tradeState = alertData.state || "open";
    console.log(`Alert data state: ${tradeState}`);

    // Load bot config + API key
    const bot = webhook.bots;
    const { data: apiKey, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', webhook.user_id)
      .eq('exchange', 'bybit')
      .single();
    
    if (apiKeyError || !apiKey) {
      console.error("API key not found:", apiKeyError);
      
      await logEvent(
        supabase,
        'error',
        'API credentials not found',
        { error: apiKeyError },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
      
      return new Response(
        JSON.stringify({ error: 'API credentials not found' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Check if this is a closing signal
    if (tradeState === "close") {
      console.log("Processing CLOSE signal...");
      
      await logEvent(
        supabase,
        'info',
        'Processing CLOSE trade signal',
        { symbol: alertData.symbol || bot.symbol },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
      
      // Find the matching open trade
      const symbol = (alertData.symbol || bot.symbol || '').toUpperCase();
      const { data: openTrade, error: tradeError } = await supabase
        .from('trades')
        .select('*')
        .eq('bot_id', webhook.bot_id)
        .eq('symbol', symbol)
        .eq('state', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (tradeError || !openTrade) {
        console.error("No matching open trade found:", tradeError);
        
        await logEvent(
          supabase,
          'error',
          'No matching open trade found to close',
          { 
            symbol,
            error: tradeError,
            bot_id: webhook.bot_id
          },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
        
        return new Response(
          JSON.stringify({ error: 'No matching open trade found to close' }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
      
      console.log(`Found open trade to close: ${openTrade.id}`);
      
      let closeResult = null;
      let realizedPnl = alertData.realized_pnl || null;
      let closeReason = 'signal';
      
      // Check if we need to execute an order (if TP/SL wasn't set originally)
      if (!openTrade.stop_loss && !openTrade.take_profit) {
        console.log("No TP/SL was set, executing close order");
        
        // Determine closing side (opposite of the open trade)
        const closeSide = openTrade.side === 'Buy' ? 'Sell' : 'Buy';
        
        // Execute the closing order
        const orderParams = {
          apiKey: apiKey.api_key,
          apiSecret: apiKey.api_secret,
          symbol: symbol,
          side: closeSide,
          orderType: 'Market',
          quantity: openTrade.quantity,
          testnet: bot.test_mode
        };
        
        console.log("Executing closing order with params:", JSON.stringify({
          ...orderParams,
          apiKey: "REDACTED",
          apiSecret: "REDACTED"
        }));
        
        try {
          if (bot.test_mode) {
            // Simulate order execution for test mode
            closeResult = {
              orderId: `close-test-${Date.now()}`,
              symbol: orderParams.symbol,
              side: orderParams.side,
              orderType: orderParams.orderType,
              qty: orderParams.quantity,
              price: alertData.price || openTrade.price * 1.01, // Simulate a 1% move in closing price
              status: 'TEST_CLOSE'
            };
            
            // Simulate PnL calculation
            // For buys: (close_price - open_price) * quantity
            // For sells: (open_price - close_price) * quantity
            if (openTrade.side === 'Buy') {
              realizedPnl = (closeResult.price - openTrade.price) * openTrade.quantity;
            } else {
              realizedPnl = (openTrade.price - closeResult.price) * openTrade.quantity;
            }
            
            // Simulate fees (typically 0.1% of trade value)
            const fees = closeResult.price * closeResult.qty * 0.001;
            realizedPnl -= fees;
            
            await logEvent(
              supabase,
              'info',
              'Simulated close order executed',
              { 
                order: closeResult,
                pnl: realizedPnl,
                trade_id: openTrade.id
              },
              webhook.id,
              webhook.bot_id,
              webhook.user_id
            );
          } else {
            // Execute actual order on Bybit
            closeResult = await executeBybitOrder(orderParams);
            
            // If the API doesn't return PnL, we calculate it
            if (!realizedPnl) {
              if (openTrade.side === 'Buy') {
                realizedPnl = (closeResult.price - openTrade.price) * openTrade.quantity;
              } else {
                realizedPnl = (openTrade.price - closeResult.price) * openTrade.quantity;
              }
              
              // Approximate fees (0.1% of the total trade value)
              const fees = closeResult.price * closeResult.qty * 0.001;
              realizedPnl -= fees;
            }
            
            await logEvent(
              supabase,
              'info',
              'Close order executed',
              { 
                order: closeResult,
                pnl: realizedPnl,
                trade_id: openTrade.id
              },
              webhook.id,
              webhook.bot_id,
              webhook.user_id
            );
          }
        } catch (error) {
          console.error('Error executing close order:', error);
          
          await logEvent(
            supabase,
            'error',
            'Failed to execute close order',
            { 
              error: error.message,
              symbol,
              trade_id: openTrade.id
            },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
          
          return new Response(
            JSON.stringify({ error: `Failed to execute close order: ${error.message}` }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }
      } else {
        console.log("TP/SL was set, assuming exchange handled the closure");
        closeReason = alertData.close_reason || 'take_profit';
        
        await logEvent(
          supabase,
          'info',
          `Trade closed by ${closeReason}`,
          { 
            trade_id: openTrade.id,
            reason: closeReason,
            pnl: realizedPnl
          },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
      }
      
      // Update the trade record
      console.log(`Updating trade ${openTrade.id} with realized PnL: ${realizedPnl}`);
      const { error: updateError } = await supabase
        .from('trades')
        .update({
          state: 'closed',
          close_reason: closeReason,
          realized_pnl: realizedPnl
        })
        .eq('id', openTrade.id);
      
      if (updateError) {
        console.error("Error updating trade:", updateError);
        
        await logEvent(
          supabase,
          'error',
          'Failed to update trade record',
          { 
            error: updateError,
            trade_id: openTrade.id
          },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
      }
      
      // Update bot's profit/loss
      if (realizedPnl) {
        console.log(`Updating bot's profit/loss with: ${realizedPnl}`);
        const { error: botUpdateError } = await supabase
          .from('bots')
          .update({
            profit_loss: (bot.profit_loss || 0) + realizedPnl,
            updated_at: new Date().toISOString()
          })
          .eq('id', webhook.bot_id);
          
        if (botUpdateError) {
          console.error("Error updating bot's profit/loss:", botUpdateError);
          
          await logEvent(
            supabase,
            'error',
            'Failed to update bot profit/loss',
            { 
              error: botUpdateError,
              bot_id: webhook.bot_id,
              pnl: realizedPnl
            },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
        }
      }
      
      // Return success response
      return new Response(
        JSON.stringify({
          success: true,
          message: "Trade closed successfully",
          tradeId: openTrade.id,
          realizedPnl: realizedPnl,
          closeReason: closeReason
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
    
    // If we reach here, we're processing an OPEN trade signal
    console.log("Processing OPEN signal...");
    
    await logEvent(
      supabase,
      'info',
      'Processing OPEN trade signal',
      { 
        symbol: alertData.symbol || bot.symbol,
        side: alertData.side || bot.default_side
      },
      webhook.id,
      webhook.bot_id,
      webhook.user_id
    );

    // ─────── RISK MANAGEMENT CHECK ───────
    // Check if there are any risk management settings to enforce
    if (bot.daily_loss_limit || bot.max_position_size) {
      console.log("Performing risk management checks...");
      
      // Check daily loss limit
      if (bot.daily_loss_limit > 0) {
        // Get today's trades and calculate daily P/L
        const today = new Date().toISOString().split('T')[0];
        const { data: todayTrades, error: tradesError } = await supabase
          .from('trades')
          .select('realized_pnl')
          .eq('bot_id', webhook.bot_id)
          .eq('user_id', webhook.user_id)
          .gte('created_at', `${today}T00:00:00.000Z`);
          
        if (tradesError) {
          console.error("Error fetching today's trades:", tradesError);
          
          await logEvent(
            supabase,
            'error',
            "Failed to fetch today's trades for risk check",
            { error: tradesError },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
        } else {
          // Calculate total P/L for today
          const dailyPnL = todayTrades.reduce((total, trade) => {
            return total + (trade.realized_pnl || 0);
          }, 0);
          
          // If we've already lost more than the daily limit, reject the trade
          if (dailyPnL < 0 && Math.abs(dailyPnL) >= bot.daily_loss_limit) {
            console.log(`Daily loss limit exceeded: ${Math.abs(dailyPnL)} >= ${bot.daily_loss_limit}`);
            
            await logEvent(
              supabase,
              'warning',
              'Trade rejected: Daily loss limit exceeded',
              { 
                daily_loss: Math.abs(dailyPnL),
                limit: bot.daily_loss_limit 
              },
              webhook.id,
              webhook.bot_id,
              webhook.user_id
            );
            
            return new Response(
              JSON.stringify({ 
                error: 'Daily loss limit exceeded', 
                dailyLoss: Math.abs(dailyPnL),
                limit: bot.daily_loss_limit 
              }),
              {
                status: 403,
                headers: {
                  ...corsHeaders,
                  "Content-Type": "application/json"
                }
              }
            );
          }
          
          console.log(`Daily P/L check passed: ${dailyPnL} / limit ${bot.daily_loss_limit}`);
        }
      }
      
      // Check max position size
      const rawQty = parseFloat(alertData.quantity ?? bot.default_quantity ?? 0);
      const estPrice = parseFloat(alertData.price ?? 0);
      
      if (bot.max_position_size > 0 && estPrice > 0) {
        const estimatedPositionSize = rawQty * estPrice;
        if (estimatedPositionSize > bot.max_position_size) {
          console.log(`Position size exceeded: ${estimatedPositionSize} > ${bot.max_position_size}`);
          
          await logEvent(
            supabase,
            'warning',
            'Trade rejected: Position size exceeds maximum allowed',
            { 
              position_size: estimatedPositionSize,
              limit: bot.max_position_size 
            },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
          
          return new Response(
            JSON.stringify({ 
              error: 'Position size exceeds maximum allowed', 
              positionSize: estimatedPositionSize,
              limit: bot.max_position_size 
            }),
            {
              status: 403,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }
        
        console.log(`Position size check passed: ${estimatedPositionSize} / limit ${bot.max_position_size}`);
      }
    }

    // ─────── MIN QTY FETCH & ROUND ───────
    const symbol = (alertData.symbol || bot.symbol || '').toUpperCase();
    const baseUrl = bot.test_mode ? TESTNET_URL : MAINNET_URL;
    // fetch instrument info
    try {
      const infoRes = await fetch(
        `${baseUrl}/v5/market/instruments-info?symbol=${symbol}&category=linear`
      );
      const infoJson = await infoRes.json();
      if (infoJson.retCode !== 0) {
        const error = `InstrumentsInfo error: ${infoJson.retMsg}`;
        console.error(error);
        
        await logEvent(
          supabase,
          'error',
          'Failed to fetch instrument info',
          { 
            error: infoJson.retMsg,
            symbol 
          },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
        
        throw new Error(error);
      }
      const inst = infoJson.result.list[0];
      const lotFilter = inst.lotSizeFilter;
      const minQtyStr = lotFilter.minOrderQty ?? lotFilter.minTrdAmt;
      const stepStr = lotFilter.qtyStep ?? lotFilter.stepSize;
      const minQty = parseFloat(minQtyStr);
      const step = parseFloat(stepStr);
      const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
      const rawQty = parseFloat(alertData.quantity ?? bot.default_quantity ?? 0);
      let qty = rawQty < minQty
        ? minQty
        : Math.floor(rawQty / step) * step;
      if (qty < minQty) qty = minQty;
      const adjustedQty = parseFloat(qty.toFixed(decimals));
      console.log(
        `Adjusted quantity from ${rawQty} → ${adjustedQty}` +
        ` (minQty=${minQty}, step=${step})`
      );

      // ─────── BUILD ORDER PARAMS ───────
      // Get stop loss and take profit values from alert or bot defaults
      const stopLoss = alertData.stopLoss || bot.default_stop_loss || null;
      const takeProfit = alertData.takeProfit || bot.default_take_profit || null;
      
      const orderParams = {
        apiKey: apiKey.api_key,
        apiSecret: apiKey.api_secret,
        symbol,
        side: alertData.side || bot.default_side || 'Buy',
        orderType: alertData.orderType || bot.default_order_type || 'Market',
        quantity: adjustedQty,
        price: alertData.price,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        testnet: bot.test_mode
      };
      
      console.log(
        "Order parameters prepared:",
        JSON.stringify({ ...orderParams, apiKey: "REDACTED", apiSecret: "REDACTED" })
      );
      
      let orderResult;
      
      try {
        // Check if in test mode
        if (bot.test_mode) {
          console.log("Test mode enabled, simulating order execution");
          // Simulate order execution
          orderResult = {
            orderId: `test-${Date.now()}`,
            symbol: orderParams.symbol,
            side: orderParams.side,
            orderType: orderParams.orderType,
            qty: orderParams.quantity,
            price: orderParams.price || 0,
            status: 'TEST_ORDER'
          };
          
          await logEvent(
            supabase,
            'info',
            'Simulated test order executed',
            { order: orderResult },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
        } else {
          console.log("Executing actual order on Bybit");
          // Execute actual order
          orderResult = await executeBybitOrder(orderParams);
          
          await logEvent(
            supabase,
            'info',
            'Order executed successfully',
            { order: orderResult },
            webhook.id,
            webhook.bot_id,
            webhook.user_id
          );
        }
        
        console.log("Order result:", JSON.stringify(orderResult));
      } catch (error) {
        console.error('Error executing order:', error);
        
        await logEvent(
          supabase,
          'error',
          'Failed to execute order',
          { 
            error: error.message,
            order_params: {...orderParams, apiKey: "[REDACTED]", apiSecret: "[REDACTED]"}
          },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
        
        return new Response(
          JSON.stringify({ error: `Failed to execute order: ${error.message}` }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
      
      // Calculate PnL (for test orders, we'll simulate a reasonable value)
      let realizedPnl = null;
      let fees = 0;
      
      if (bot.test_mode) {
        // Simulate a realistic PnL for test orders (random value between -2% and +2%)
        const simulatedPriceChange = (Math.random() * 4) - 2; // Between -2% and +2%
        const baseAmount = orderParams.price * orderParams.quantity;
        
        // For Buy orders, positive price change = profit
        // For Sell orders, negative price change = profit
        if (orderParams.side === 'Buy') {
          realizedPnl = baseAmount * (simulatedPriceChange / 100);
        } else {
          realizedPnl = baseAmount * (-simulatedPriceChange / 100);
        }
        
        // Simulate fees (typically 0.1% of trade value)
        fees = baseAmount * 0.001;
        
        // Adjust final PnL
        realizedPnl = realizedPnl - fees;
        
        console.log(`Simulated PnL: ${realizedPnl.toFixed(2)}, Fees: ${fees.toFixed(2)}`);
      }
      
      // Log the trade
      console.log("Logging trade to database...");
      const { data: tradeData, error: tradeError } = await supabase
        .from('trades')
        .insert({
          user_id: webhook.user_id,
          bot_id: webhook.bot_id,
          symbol: orderResult.symbol,
          side: orderResult.side,
          order_type: orderResult.orderType,
          quantity: orderResult.qty,
          price: orderResult.price,
          order_id: orderResult.orderId,
          status: orderResult.status,
          realized_pnl: realizedPnl,
          fees: fees,
          state: 'open',
          stop_loss: stopLoss,
          take_profit: takeProfit,
          created_at: new Date().toISOString()
        });
        
      if (tradeError) {
        console.error("Error logging trade:", tradeError);
        
        await logEvent(
          supabase,
          'error',
          'Failed to save trade to database',
          { error: tradeError },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
      } else {
        console.log("Trade successfully logged to database");
      }
      
      // Update bot's last trade timestamp and profit/loss
      console.log("Updating bot's stats...");
      const { data: botUpdateData, error: botUpdateError } = await supabase
        .from('bots')
        .update({
          last_trade_at: new Date().toISOString(),
          trade_count: bot.trade_count ? bot.trade_count + 1 : 1,
          profit_loss: (bot.profit_loss || 0) + (realizedPnl || 0)
        })
        .eq('id', webhook.bot_id);
        
      if (botUpdateError) {
        console.error("Error updating bot:", botUpdateError);
        
        await logEvent(
          supabase,
          'error',
          'Failed to update bot statistics',
          { error: botUpdateError },
          webhook.id,
          webhook.bot_id,
          webhook.user_id
        );
      } else {
        console.log("Bot successfully updated");
      }
      
      await logEvent(
        supabase,
        'info',
        'Trade processing completed successfully',
        { 
          order_id: orderResult.orderId,
          status: orderResult.status
        },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
      
      console.log("Process completed successfully");
      return new Response(
        JSON.stringify({
          success: true,
          orderId: orderResult.orderId,
          status: orderResult.status,
          testMode: bot.test_mode,
          pnl: realizedPnl,
          fees: fees
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
      console.error('Error processing order:', error);
      
      await logEvent(
        supabase,
        'error',
        'Unexpected error processing alert',
        { error: error.message },
        webhook.id,
        webhook.bot_id,
        webhook.user_id
      );
      
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
  } catch (error) {
    console.error('Error processing alert:', error);
    
    // Try to log the error even if we don't have webhook details
    try {
      await logEvent(
        supabase,
        'error',
        'Critical error processing alert',
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
