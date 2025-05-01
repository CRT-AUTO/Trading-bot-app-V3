import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight, Bot, RefreshCw, CheckCircle, XCircle, Play, Pause, Key } from 'lucide-react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';

type ApiKey = {
  id: string;
  name: string;
};

type Bot = {
  id: string;
  name: string;
  symbol: string;
  status: 'active' | 'paused' | 'error';
  created_at: string;
  last_trade_at: string | null;
  trade_count: number;
  profit_loss: number;
  test_mode: boolean;
  description?: string;
  api_key_id?: string | null;
  api_key_name?: string | null;
};

const Bots: React.FC = () => {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBots, setActiveBots] = useState<Bot[]>([]);
  const [pausedBots, setPausedBots] = useState<Bot[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchBots = async () => {
      if (!user) return;

      setLoading(true);
      
      try {
        // Fetch API keys first
        const { data: keys, error: keysError } = await supabase
          .from('api_keys')
          .select('id, name')
          .eq('user_id', user.id);
          
        if (keysError) throw keysError;
        
        // Convert to lookup object
        const keyLookup = (keys || []).reduce((acc: Record<string, string>, key) => {
          acc[key.id] = key.name;
          return acc;
        }, {});
        
        setApiKeys(keyLookup);
        
        // Fetch bots
        const { data, error } = await supabase
          .from('bots')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Add API key name to each bot
        const botsWithKeyNames = (data || []).map(bot => ({
          ...bot,
          api_key_name: bot.api_key_id ? keyLookup[bot.api_key_id] : 'Default'
        }));
        
        setBots(botsWithKeyNames);
        
        // Separate active and paused bots
        const active = botsWithKeyNames.filter(bot => bot.status === 'active') || [];
        const paused = botsWithKeyNames.filter(bot => bot.status !== 'active') || [];
        
        setActiveBots(active);
        setPausedBots(paused);
      } catch (error) {
        console.error('Error fetching bots:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBots();
  }, [supabase, user]);

  // Function to toggle bot status
  const toggleBotStatus = async (botId: string, currentStatus: string) => {
    if (!user) return;
    
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    
    try {
      const { error } = await supabase
        .from('bots')
        .update({ status: newStatus })
        .eq('id', botId)
        .eq('user_id', user.id);
        
      if (error) throw error;
      
      // Update local state
      setBots(prevBots => prevBots.map(bot => 
        bot.id === botId ? { ...bot, status: newStatus } : bot
      ));
      
      // Update active/paused lists
      if (newStatus === 'active') {
        const bot = [...pausedBots].find(b => b.id === botId);
        if (bot) {
          setPausedBots(prevBots => prevBots.filter(b => b.id !== botId));
          setActiveBots(prevBots => [...prevBots, { ...bot, status: 'active' }]);
        }
      } else {
        const bot = [...activeBots].find(b => b.id === botId);
        if (bot) {
          setActiveBots(prevBots => prevBots.filter(b => b.id !== botId));
          setPausedBots(prevBots => [...prevBots, { ...bot, status: 'paused' }]);
        }
      }
    } catch (error) {
      console.error('Error toggling bot status:', error);
      alert('Failed to update bot status');
    }
  };

  const BotCard = ({ bot }: { bot: Bot }) => {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
        <div className="flex justify-between items-start mb-4">
          <Link to={`/bots/${bot.id}`} className="font-medium text-lg hover:text-blue-600 transition-colors">
            {bot.name}
          </Link>
          <div className={`px-2 py-1 rounded text-xs font-medium ${
            bot.status === 'active' ? 'bg-green-100 text-green-800' :
            bot.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`}>
            {bot.status === 'active' ? 'Active' :
             bot.status === 'paused' ? 'Paused' : 'Error'}
          </div>
        </div>
        <div className="text-gray-600 mb-1">Symbol: {bot.symbol}</div>
        <div className="text-gray-600 mb-1">
          Test Mode: {bot.test_mode ? 
            <span className="text-yellow-600">Enabled</span> : 
            <span className="text-green-600">Disabled</span>}
        </div>
        <div className="text-gray-600 mb-1">
          API Key: <span className="inline-flex items-center">
            <Key size={14} className="text-blue-500 mr-1" />
            {bot.api_key_name || 'Default'}
          </span>
        </div>
        <div className="text-gray-600 mb-4">
          Trades: {bot.trade_count || 0} | P/L: {(bot.profit_loss || 0).toFixed(2)} USDT
        </div>
        {bot.description && (
          <div className="text-gray-600 mb-4 text-sm line-clamp-2">
            {bot.description}
          </div>
        )}
        <div className="text-xs text-gray-500 mb-1">
          Created: {format(new Date(bot.created_at), 'MMM dd, yyyy')}
        </div>
        {bot.last_trade_at && (
          <div className="text-xs text-gray-500 mb-4">
            Last trade: {format(new Date(bot.last_trade_at), 'MMM dd, yyyy HH:mm')}
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => toggleBotStatus(bot.id, bot.status)}
            className={`flex items-center px-3 py-1 rounded-md text-xs transition-colors ${
              bot.status === 'active'
                ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                : 'bg-green-100 text-green-800 hover:bg-green-200'
            }`}
          >
            {bot.status === 'active' ? (
              <>
                <Pause size={12} className="mr-1" />
                Pause
              </>
            ) : (
              <>
                <Play size={12} className="mr-1" />
                Activate
              </>
            )}
          </button>
          <Link
            to={`/bots/${bot.id}`}
            className="flex items-center px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded-md hover:bg-blue-200 transition-colors"
          >
            Edit <ArrowRight size={12} className="ml-1" />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Trading Bots</h1>
        <Link
          to="/bots/new"
          className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus size={18} className="mr-2" />
          <span>New Bot</span>
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw size={32} className="text-blue-600 animate-spin" />
        </div>
      ) : bots.length === 0 ? (
        <div className="bg-white p-8 rounded-lg shadow-sm text-center">
          <Bot size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium">No Bots Yet</h3>
          <p className="text-gray-500 mb-4">Create your first trading bot to get started</p>
          <Link
            to="/bots/new"
            className="inline-flex items-center text-blue-600 hover:text-blue-800"
          >
            Create a new bot <ArrowRight size={16} className="ml-2" />
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Active bots section */}
          {activeBots.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <CheckCircle size={20} className="text-green-600 mr-2" /> 
                Active Bots
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeBots.map(bot => (
                  <BotCard key={bot.id} bot={bot} />
                ))}
              </div>
            </div>
          )}
          
          {/* Paused bots section */}
          {pausedBots.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <Pause size={20} className="text-yellow-600 mr-2" /> 
                Paused Bots
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pausedBots.map(bot => (
                  <BotCard key={bot.id} bot={bot} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Bots;
