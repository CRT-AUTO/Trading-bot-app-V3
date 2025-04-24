import React, { useState, useEffect } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { RefreshCw, Search, Filter, Download, ArrowUp, ArrowDown } from 'lucide-react';

type Trade = {
  id: string;
  bot_id: string;
  bot_name: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  order_type: string;
  quantity: number;
  price: number;
  status: string;
  order_id: string;
  created_at: string;
  realized_pnl?: number;
  unrealized_pnl?: number;
  fees?: number;
  state?: string;
  stop_loss?: number;
  take_profit?: number;
  close_reason?: string;
};

const TradeHistory: React.FC = () => {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [botFilter, setBotFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [uniqueSymbols, setUniqueSymbols] = useState<string[]>([]);
  const [uniqueBots, setUniqueBots] = useState<{id: string; name: string}[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const fetchTradeHistory = async () => {
      if (!user) return;
      
      setLoading(true);
      try {
        // Fetch trade history with bot names
        const { data, error } = await supabase
          .from('trades')
          .select(`
            *,
            bots:bot_id (name)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Map to include bot name directly in trade object
        const tradesWithBotNames = data?.map(trade => ({
          ...trade,
          bot_name: trade.bots?.name || 'Unknown'
        })) || [];
        
        setTrades(tradesWithBotNames);
        
        // Calculate total PnL
        const total = tradesWithBotNames.reduce((sum, trade) => {
          return sum + (trade.realized_pnl || 0);
        }, 0);
        setTotalPnl(total);
        
        // Extract unique symbols and bots for filters
        const symbols = [...new Set(tradesWithBotNames.map(trade => trade.symbol))];
        setUniqueSymbols(symbols);
        
        const bots = tradesWithBotNames.reduce((acc: {id: string; name: string}[], trade) => {
          if (trade.bot_id && !acc.some(bot => bot.id === trade.bot_id)) {
            acc.push({ id: trade.bot_id, name: trade.bot_name });
          }
          return acc;
        }, []);
        setUniqueBots(bots);
        
      } catch (error) {
        console.error('Error fetching trade history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTradeHistory();
  }, [supabase, user]);

  // Sort trades
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Filter trades based on search and filters
  const filteredTrades = trades.filter(trade => {
    const matchesSearch = searchTerm === '' || 
      trade.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.bot_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.side.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.order_id.toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesSymbol = symbolFilter === '' || trade.symbol === symbolFilter;
    const matchesBot = botFilter === '' || trade.bot_id === botFilter;
    const matchesState = stateFilter === '' || trade.state === stateFilter;
    
    return matchesSearch && matchesSymbol && matchesBot && matchesState;
  });

  // Sort filtered trades
  const sortedTrades = [...filteredTrades].sort((a, b) => {
    if (sortField === 'created_at') {
      return sortDirection === 'asc' 
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    
    if (sortField === 'realized_pnl') {
      const aPnl = a.realized_pnl || 0;
      const bPnl = b.realized_pnl || 0;
      return sortDirection === 'asc' ? aPnl - bPnl : bPnl - aPnl;
    }
    
    if (sortField === 'price') {
      return sortDirection === 'asc' ? a.price - b.price : b.price - a.price;
    }
    
    if (sortField === 'quantity') {
      return sortDirection === 'asc' ? a.quantity - b.quantity : b.quantity - a.quantity;
    }
    
    // Default case, sort by string fields
    const aValue = (a as any)[sortField]?.toString() || '';
    const bValue = (b as any)[sortField]?.toString() || '';
    return sortDirection === 'asc' 
      ? aValue.localeCompare(bValue)
      : bValue.localeCompare(aValue);
  });

  // Export to CSV
  const exportToCsv = () => {
    if (filteredTrades.length === 0) return;
    
    const headers = ['Date', 'Bot', 'Symbol', 'Side', 'Type', 'Price', 'Quantity', 'P/L', 'Fees', 'Status', 'State', 'Close Reason', 'Order ID'];
    const csvRows = [
      headers.join(','),
      ...filteredTrades.map(trade => [
        format(new Date(trade.created_at), 'yyyy-MM-dd HH:mm:ss'),
        `"${trade.bot_name}"`,
        trade.symbol,
        trade.side,
        trade.order_type,
        trade.price,
        trade.quantity,
        trade.realized_pnl || 0,
        trade.fees || 0,
        trade.status,
        trade.state || 'open',
        trade.close_reason || '',
        trade.order_id
      ].join(','))
    ];
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trade_history_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.click();
  };

  // Render sort indicator
  const renderSortIndicator = (field: string) => {
    if (sortField !== field) return null;
    
    return sortDirection === 'asc' 
      ? <ArrowUp size={14} className="ml-1 inline" /> 
      : <ArrowDown size={14} className="ml-1 inline" />;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Trade History</h1>
        <button
          onClick={exportToCsv}
          disabled={filteredTrades.length === 0}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:bg-gray-400"
        >
          <Download size={18} className="mr-2" />
          Export CSV
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search trades..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <div className="w-40">
              <select
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">All Symbols</option>
                {uniqueSymbols.map(symbol => (
                  <option key={symbol} value={symbol}>{symbol}</option>
                ))}
              </select>
            </div>
            
            <div className="w-40">
              <select
                value={botFilter}
                onChange={(e) => setBotFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">All Bots</option>
                {uniqueBots.map(bot => (
                  <option key={bot.id} value={bot.id}>{bot.name}</option>
                ))}
              </select>
            </div>
            
            <div className="w-40">
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">All States</option>
                <option value="open">Open Trades</option>
                <option value="closed">Closed Trades</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3">
            <div className="text-sm text-gray-500">Total Trades</div>
            <div className="text-xl font-semibold">{filteredTrades.length}</div>
          </div>
          
          <div className="p-3">
            <div className="text-sm text-gray-500">Total Profit/Loss</div>
            <div className={`text-xl font-semibold ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalPnl.toFixed(2)} USDT
            </div>
          </div>
          
          <div className="p-3">
            <div className="text-sm text-gray-500">Average P/L per Trade</div>
            <div className={`text-xl font-semibold ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {filteredTrades.length > 0 ? (totalPnl / filteredTrades.length).toFixed(2) : '0.00'} USDT
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw size={32} className="text-blue-600 animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {filteredTrades.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No trades found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('created_at')}
                    >
                      Date {renderSortIndicator('created_at')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('bot_name')}
                    >
                      Bot {renderSortIndicator('bot_name')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('symbol')}
                    >
                      Symbol {renderSortIndicator('symbol')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('side')}
                    >
                      Side {renderSortIndicator('side')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('order_type')}
                    >
                      Type {renderSortIndicator('order_type')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('price')}
                    >
                      Price {renderSortIndicator('price')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('quantity')}
                    >
                      Quantity {renderSortIndicator('quantity')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('realized_pnl')}
                    >
                      P/L {renderSortIndicator('realized_pnl')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('state')}
                    >
                      State {renderSortIndicator('state')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('status')}
                    >
                      Status {renderSortIndicator('status')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(trade.created_at), 'MMM dd, yyyy HH:mm:ss')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.bot_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {trade.symbol}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          trade.side === 'Buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {trade.side}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {trade.order_type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.price.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {trade.realized_pnl !== null && trade.realized_pnl !== undefined ? (
                          <span className={`font-medium ${trade.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {trade.realized_pnl.toFixed(2)} USDT
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          trade.state === 'open' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {trade.state || 'open'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          trade.status === 'Filled' ? 'bg-green-100 text-green-800' :
                          trade.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {trade.status}
                          {trade.close_reason ? ` (${trade.close_reason})` : ''}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {trade.order_id.substring(0, 8)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TradeHistory;