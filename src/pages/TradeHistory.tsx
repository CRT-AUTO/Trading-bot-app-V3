import React, { useState, useEffect } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { RefreshCw, Search, Filter, Download, ArrowUp, ArrowDown, Info } from 'lucide-react';

type TradeMetrics = {
  targetRR: number;
  finishedRR: number;
  slippage: number;
  formattedTradeTime: string;
  totalTradeTimeSeconds: number;
  deviationPercentFromMaxRisk: number;
  totalFees: number;
  maxRisk: number;
  positionNotional: number;
  riskPerUnit: number;
  symbol?: string;
  side?: string;
  wantedEntry?: number;
  stopLoss?: number;
  takeProfit?: number;
};

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
  slippage?: number;
  state?: string;
  stop_loss?: number;
  take_profit?: number;
  close_reason?: string;
  avg_entry_price?: number;
  avg_exit_price?: number;
  exit_price?: number;
  updated_at?: string;
  details?: any;
  trade_metrics?: TradeMetrics;
  risk_amount?: number;
};

type TimeRange = '1w' | '1m' | '3m' | 'all';

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
  const [uniqueBots, setUniqueBots] = useState<{id: string, name: string}[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [updatingTradeId, setUpdatingTradeId] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showMetricsModal, setShowMetricsModal] = useState(false);

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

  useEffect(() => {
    fetchTradeHistory();
  }, [supabase, user]);

  // Function to manually update trade PnL
  const handleManualUpdate = async (trade: Trade) => {
    if (trade.realized_pnl !== null && trade.realized_pnl !== undefined) {
      alert('This trade already has PnL data.');
      return;
    }

    try {
      setUpdatingTradeId(trade.id);
      
      // Call the manualUpdateTradePnl edge function
      const response = await fetch('/.netlify/functions/manualUpdateTradePnl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tradeId: trade.id }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to update trade PnL:', errorText);
        alert(`Failed to update trade PnL: ${errorText}`);
        return;
      }
      
      const result = await response.json();
      console.log('Trade PnL manual update result:', result);
      
      if (!result.success && result.message === "No matching closed PnL found") {
        alert('No matching closed PnL found for this trade. The trade may still be open on the exchange or the data is not yet available from the API.');
        return;
      }
      
      // Refresh trade history to reflect the updated PnL
      await fetchTradeHistory();
      
      alert('Trade PnL updated successfully!');
    } catch (error) {
      console.error('Error updating trade PnL:', error);
      alert(`Error updating trade PnL: ${error}`);
    } finally {
      setUpdatingTradeId(null);
    }
  };

  // Function to open trade metrics modal
  const showTradeMetrics = (trade: Trade) => {
    setSelectedTrade(trade);
    setShowMetricsModal(true);
  };

  // Calculate R Multiple (Risk Multiple) for a trade
  const calculateRMultiple = (trade: Trade): string => {
    // If we have the trade metrics with finishedRR, use it directly
    if (trade.trade_metrics?.finishedRR !== undefined) {
      return `${trade.trade_metrics.finishedRR.toFixed(2)}R`;
    }
    
    // If we have risk_amount stored directly in the trade, use that
    if (trade.risk_amount && trade.risk_amount > 0 && trade.realized_pnl !== undefined) {
      const rMultiple = trade.realized_pnl / trade.risk_amount;
      return `${rMultiple.toFixed(2)}R`;
    }
    
    // Otherwise calculate it manually if we have entry, stop, and PnL
    const entryPrice = trade.avg_entry_price || trade.price;
    const stopLoss = trade.stop_loss;
    const pnl = trade.realized_pnl || 0;
    
    if (!entryPrice || !stopLoss || stopLoss === 0) {
      return '-';
    }
    
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    const positionValue = entryPrice * trade.quantity;
    const maxRiskAmount = riskPerUnit * trade.quantity;
    
    if (maxRiskAmount <= 0) {
      return '-';
    }
    
    // PnL / Risk Amount = R multiple
    const rMultiple = pnl / maxRiskAmount;
    return `${rMultiple.toFixed(2)}R`;
  };

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
    
    if (sortField === 'avg_entry_price') {
      const aPrice = a.avg_entry_price || 0;
      const bPrice = b.avg_entry_price || 0;
      return sortDirection === 'asc' ? aPrice - bPrice : bPrice - aPrice;
    }
    
    if (sortField === 'avg_exit_price') {
      const aPrice = a.avg_exit_price || 0;
      const bPrice = b.avg_exit_price || 0;
      return sortDirection === 'asc' ? aPrice - bPrice : bPrice - aPrice;
    }
    
    if (sortField === 'fees') {
      const aFees = a.fees || 0;
      const bFees = b.fees || 0;
      return sortDirection === 'asc' ? aFees - bFees : bFees - aFees;
    }

    if (sortField === 'risk_amount') {
      const aRisk = a.risk_amount || (a.trade_metrics?.maxRisk || 0);
      const bRisk = b.risk_amount || (b.trade_metrics?.maxRisk || 0);
      return sortDirection === 'asc' ? aRisk - bRisk : bRisk - aRisk;
    }

    if (sortField === 'trade_metrics.targetRR') {
      const aRR = a.trade_metrics?.targetRR || 0;
      const bRR = b.trade_metrics?.targetRR || 0;
      return sortDirection === 'asc' ? aRR - bRR : bRR - aRR;
    }

    if (sortField === 'trade_metrics.finishedRR') {
      const aRR = a.trade_metrics?.finishedRR || 0;
      const bRR = b.trade_metrics?.finishedRR || 0;
      return sortDirection === 'asc' ? aRR - bRR : bRR - aRR;
    }

    if (sortField === 'trade_metrics.totalTradeTimeSeconds') {
      const aTime = a.trade_metrics?.totalTradeTimeSeconds || 0;
      const bTime = b.trade_metrics?.totalTradeTimeSeconds || 0;
      return sortDirection === 'asc' ? aTime - bTime : bTime - aTime;
    }
    
    if (sortField === 'r_multiple') {
      // Sort by R multiple - extract the numeric part from the string and convert to number
      const aR = parseFloat(calculateRMultiple(a).replace('R', '')) || 0;
      const bR = parseFloat(calculateRMultiple(b).replace('R', '')) || 0;
      return sortDirection === 'asc' ? aR - bR : bR - aR;
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
    
    const headers = [
      'Date', 'Bot', 'Symbol', 'Side', 'Type', 'Price', 'Quantity', 
      'Entry Price', 'Exit Price', 'P/L', 'P/L (R)', 'Fees', 
      'Risk', 'Stop Loss', 'Take Profit', 'Status', 'State', 'Close Reason', 'Order ID',
      'Target R:R', 'Actual R:R', 'Trade Duration', 'Slippage', 'Max Risk'
    ];
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
        trade.avg_entry_price || trade.price || '',
        trade.avg_exit_price || trade.exit_price || '',
        trade.realized_pnl || 0,
        calculateRMultiple(trade),
        trade.fees || 0,
        trade.risk_amount || trade.trade_metrics?.maxRisk || 0,
        trade.stop_loss || '',
        trade.take_profit || '',
        trade.status,
        trade.state || 'open',
        trade.close_reason || '',
        trade.order_id,
        trade.trade_metrics?.targetRR?.toFixed(2) || '',
        trade.trade_metrics?.finishedRR?.toFixed(2) || '',
        trade.trade_metrics?.formattedTradeTime || '',
        trade.trade_metrics?.slippage?.toFixed(6) || '',
        trade.trade_metrics?.maxRisk || ''
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

          <div className="p-3">
            <div className="text-sm text-gray-500">Win Rate</div>
            <div className="text-xl font-semibold text-blue-600">
              {(() => {
                const closedTrades = filteredTrades.filter(t => t.state === 'closed');
                if (closedTrades.length === 0) return '0.00%';
                const winningTrades = closedTrades.filter(t => (t.realized_pnl || 0) > 0);
                return ((winningTrades.length / closedTrades.length) * 100).toFixed(1) + '%';
              })()}
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
                      onClick={() => handleSort('quantity')}
                    >
                      Qty {renderSortIndicator('quantity')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('price')}
                    >
                      Price {renderSortIndicator('price')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('avg_entry_price')}
                    >
                      Entry {renderSortIndicator('avg_entry_price')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('avg_exit_price')}
                    >
                      Exit {renderSortIndicator('avg_exit_price')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('realized_pnl')}
                    >
                      P/L $ {renderSortIndicator('realized_pnl')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('r_multiple')}
                    >
                      P/L R {renderSortIndicator('r_multiple')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('risk_amount')}
                    >
                      Risk {renderSortIndicator('risk_amount')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('fees')}
                    >
                      Fees {renderSortIndicator('fees')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('stop_loss')}
                    >
                      SL {renderSortIndicator('stop_loss')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('take_profit')}
                    >
                      TP {renderSortIndicator('take_profit')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('trade_metrics.targetRR')}
                    >
                      Target R:R {renderSortIndicator('trade_metrics.targetRR')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('trade_metrics.finishedRR')}
                    >
                      Actual R:R {renderSortIndicator('trade_metrics.finishedRR')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('trade_metrics.totalTradeTimeSeconds')}
                    >
                      Duration {renderSortIndicator('trade_metrics.totalTradeTimeSeconds')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('state')}
                    >
                      State {renderSortIndicator('state')}
                    </th>
                    <th 
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('close_reason')}
                    >
                      Close Reason {renderSortIndicator('close_reason')}
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {format(new Date(trade.created_at), 'MMM dd, HH:mm:ss')}
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
                        {trade.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.price?.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.avg_entry_price ? trade.avg_entry_price.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.avg_exit_price ? trade.avg_exit_price.toFixed(2) : 
                         trade.exit_price ? trade.exit_price.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {trade.realized_pnl !== null && trade.realized_pnl !== undefined ? (
                          <span className={`font-medium ${trade.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {trade.realized_pnl.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`font-medium ${
                          parseFloat(calculateRMultiple(trade)) >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {calculateRMultiple(trade)}
                        </span>
                      </td>
                       <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.risk_amount?.toFixed(2) || trade.trade_metrics?.maxRisk?.toFixed(2) || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.fees ? trade.fees.toFixed(4) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.stop_loss ? trade.stop_loss.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.take_profit ? trade.take_profit.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.trade_metrics?.targetRR ? trade.trade_metrics.targetRR.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.trade_metrics?.finishedRR ? trade.trade_metrics.finishedRR.toFixed(2) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.trade_metrics?.formattedTradeTime || 
                        (trade.trade_metrics?.totalTradeTimeSeconds ? 
                          Math.floor(trade.trade_metrics.totalTradeTimeSeconds / 60) + ' min' : 
                          '-')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          trade.state === 'open' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {trade.state || 'open'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trade.close_reason || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          trade.status === 'Filled' ? 'bg-green-100 text-green-800' :
                          trade.status === 'Cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {trade.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {trade.order_id.substring(0, 8)}...
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {trade.realized_pnl === null || trade.realized_pnl === undefined ? (
                          <button
                            onClick={() => handleManualUpdate(trade)}
                            disabled={updatingTradeId === trade.id}
                            className={`text-blue-600 hover:text-blue-900 ${updatingTradeId === trade.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {updatingTradeId === trade.id ? (
                              <span className="flex items-center">
                                <RefreshCw size={14} className="animate-spin mr-1" /> 
                                Updating...
                              </span>
                            ) : (
                              'Update PnL'
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => showTradeMetrics(trade)}
                            className="text-blue-600 hover:text-blue-900 flex items-center"
                          >
                            <Info size={14} className="mr-1" /> Details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trade Metrics Modal */}
      {showMetricsModal && selectedTrade && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-xl font-bold">Trade Details: {selectedTrade.symbol}</h3>
              <button 
                onClick={() => setShowMetricsModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                &times;
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Basic Trade Info */}
                <div className="col-span-2 mb-2 pb-2 border-b">
                  <h4 className="text-lg font-semibold mb-2">Trade Summary</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-sm text-gray-500">Symbol</p>
                      <p className="text-md font-medium">{selectedTrade.symbol}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Side</p>
                      <p className={`text-md font-medium ${selectedTrade.side === 'Buy' ? 'text-green-600' : 'text-red-600'}`}>
                        {selectedTrade.side}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Quantity</p>
                      <p className="text-md font-medium">{selectedTrade.quantity}</p>
                    </div>
                  </div>
                </div>

                {/* Price Data */}
                <div className="col-span-2 mb-2 pb-2 border-b">
                  <h4 className="text-lg font-semibold mb-2">Price Data</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-sm text-gray-500">Planned Entry</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.wantedEntry?.toFixed(2) || selectedTrade.price?.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Actual Entry</p>
                      <p className="text-md font-medium">{selectedTrade.avg_entry_price?.toFixed(2) || selectedTrade.price?.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Exit Price</p>
                      <p className="text-md font-medium">{selectedTrade.avg_exit_price?.toFixed(2) || selectedTrade.exit_price?.toFixed(2) || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Stop Loss</p>
                      <p className="text-md font-medium">{selectedTrade.stop_loss?.toFixed(2) || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Take Profit</p>
                      <p className="text-md font-medium">{selectedTrade.take_profit?.toFixed(2) || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Slippage</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.slippage?.toFixed(6) || selectedTrade.slippage?.toFixed(6) || '0'}</p>
                    </div>
                  </div>
                </div>

                {/* Risk & Reward Metrics */}
                <div className="col-span-2 mb-2 pb-2 border-b">
                  <h4 className="text-lg font-semibold mb-2">Risk & Reward</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                     <p className="text-sm text-gray-500">Max Risk</p>
                     <p className="text-md font-medium">{selectedTrade.risk_amount?.toFixed(2) || selectedTrade.trade_metrics?.maxRisk?.toFixed(2) || '-'} USDT</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Risk per Unit</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.riskPerUnit?.toFixed(6) || 
                        (selectedTrade.stop_loss ? Math.abs(selectedTrade.price - selectedTrade.stop_loss).toFixed(6) : '-')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Position Value</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.positionNotional?.toFixed(2) || 
                        (selectedTrade.price * selectedTrade.quantity).toFixed(2)} USDT</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Target R:R</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.targetRR?.toFixed(2) || '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Actual R:R</p>
                      <p className={`text-md font-medium ${
                        (selectedTrade.trade_metrics?.finishedRR || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {selectedTrade.trade_metrics?.finishedRR?.toFixed(2) || calculateRMultiple(selectedTrade)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Risk Deviation %</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.deviationPercentFromMaxRisk?.toFixed(2) || '0'}%</p>
                    </div>
                  </div>
                </div>

                {/* Time & Cost Metrics */}
                <div className="col-span-2 mb-2">
                  <h4 className="text-lg font-semibold mb-2">Time & Cost</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-sm text-gray-500">Trade Duration</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.formattedTradeTime || 
                        (selectedTrade.updated_at ? 
                          Math.floor((new Date(selectedTrade.updated_at).getTime() - new Date(selectedTrade.created_at).getTime()) / 60000) + ' min' 
                          : '-')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Total Fees</p>
                      <p className="text-md font-medium">{selectedTrade.trade_metrics?.totalFees?.toFixed(4) || selectedTrade.fees?.toFixed(4) || '0'} USDT</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Final P/L</p>
                      <p className={`text-md font-medium ${selectedTrade.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {selectedTrade.realized_pnl?.toFixed(2) || '0'} USDT ({calculateRMultiple(selectedTrade)})
                      </p>
                    </div>
                  </div>
                </div>

                {/* Trade Details JSON */}
                {selectedTrade.details && (
                  <div className="col-span-2 mt-2 pt-2 border-t">
                    <h4 className="text-lg font-semibold mb-2 flex justify-between items-center">
                      <span>Raw Trade Details</span>
                    </h4>
                    <div className="bg-gray-100 p-3 rounded-md overflow-x-auto max-h-40">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedTrade.details, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t bg-gray-50">
              <button
                onClick={() => setShowMetricsModal(false)}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradeHistory;
