// Netlify Edge Function for generating webhook URLs
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

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
  console.log("Edge Function: generateWebhook started");
  
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
    const { userId, botId, expirationDays = 30 } = body;
    
    console.log(`Request received - userId: ${userId}, botId: ${botId}, expirationDays: ${expirationDays}`);
    
    // Log webhook generation request
    await logEvent(
      supabase,
      'info',
      'Webhook generation requested',
      { user_id: userId, bot_id: botId, expiration_days: expirationDays },
      null,
      botId,
      userId
    );
    
    // Validate required fields
    if (!userId || !botId) {
      console.log("Missing required fields");
      
      await logEvent(
        supabase,
        'error',
        'Webhook generation failed: Missing required fields',
        { user_id: userId, bot_id: botId },
        null,
        botId,
        userId
      );
      
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }
    
    // Generate unique webhook token
    const webhookToken = nanoid(32);
    console.log(`Generated webhook token: ${webhookToken.substring(0, 5)}...`);
    
    // Calculate expiration date
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);
    console.log(`Expiration date set to: ${expirationDate.toISOString()}`);
    
    // Store webhook information in database
    console.log("Inserting webhook into database...");
    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        user_id: userId,
        bot_id: botId,
        webhook_token: webhookToken,
        expires_at: expirationDate.toISOString(),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();
    
    if (error) {
      console.error("Database insertion error:", error);
      
      await logEvent(
        supabase,
        'error',
        'Failed to create webhook in database',
        { error: error.message, user_id: userId, bot_id: botId },
        null,
        botId,
        userId
      );
      
      throw error;
    }
    
    console.log("Webhook successfully stored in database");
    
    // Construct webhook URL
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;
    console.log(`Using base URL: ${baseUrl}`);
    
    const webhookUrl = `${baseUrl}/.netlify/functions/processAlert/${webhookToken}`;
    console.log(`Generated webhook URL: ${webhookUrl}`);
    
    // Log successful webhook creation
    await logEvent(
      supabase,
      'info',
      'Webhook generated successfully',
      { 
        webhook_url: webhookUrl, 
        expires_at: expirationDate.toISOString(),
        webhook_id: data.id
      },
      data.id,
      botId,
      userId
    );
    
    return new Response(
      JSON.stringify({
        webhookUrl,
        expiresAt: expirationDate.toISOString()
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
    console.error('Error generating webhook:', error);
    
    // Try to log the error
    try {
      await logEvent(
        supabase,
        'error',
        'Critical error generating webhook',
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