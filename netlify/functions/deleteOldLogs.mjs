// Netlify Function for automatically deleting logs older than 7 days
import { createClient } from '@supabase/supabase-js';

export const handler = async (event, context) => {
  console.log("deleteOldLogs function started");

  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  
  console.log(`Environment check: Supabase URL exists: ${!!supabaseUrl}, Service Key exists: ${!!supabaseServiceKey}`);

  // Check if environment variables are set
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase environment variables");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server configuration error" })
    };
  }

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  console.log("Supabase client initialized");

  try {
    // Calculate the date threshold (7 days ago)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    console.log(`Deleting logs older than: ${sevenDaysAgo}`);
    
    // First, get a count of how many logs will be deleted for reporting
    const { count, error: countError } = await supabase
      .from('logs')
      .count()
      .lt('created_at', sevenDaysAgo);
      
    if (countError) {
      console.error("Error counting old logs:", countError);
      throw countError;
    }
    
    console.log(`Found ${count} logs older than 7 days to delete`);
    
    // Delete logs older than 7 days
    const { error: deleteError } = await supabase
      .from('logs')
      .delete()
      .lt('created_at', sevenDaysAgo);

    if (deleteError) {
      console.error("Error deleting old logs:", deleteError);
      throw deleteError;
    }

    console.log(`Successfully deleted ${count} logs older than 7 days`);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Successfully deleted ${count} logs older than 7 days`,
        deleted_count: count,
        threshold_date: sevenDaysAgo
      })
    };
  } catch (error) {
    console.error("Error during log deletion:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
