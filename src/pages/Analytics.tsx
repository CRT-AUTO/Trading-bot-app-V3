import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  RefreshCw, 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Percent, 
  DollarSign, 
  Calendar, 
  BarChart
} from 'lucide-react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler 
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { format, subDays } from 'date-fns';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

type Bot = {
  id: string;
  name: string;
  symbol: string;
  status: string;
  trade_count: number;
  profit_loss: number;
  created_at: string;
  last_trade_at: string | null;
};

type Trade = {
  id: string;
  bot_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  realized_pnl: number | null;
  created_at: string;
};

type TimeRange = '1w' | '1m' | '3m' | 'all';

const Analytics: React.FC = () => {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const { supabase } = useSupabase();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [bot, setBot] = useState<Bot | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');
  const [availableBots, setAvailableBots] = useState<Bot[]>([]);
  
  // Calculated metrics
  const [metrics, setMetrics] = useState({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    profitFactor: 0,
    netProfit: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
  });

  // Fetch data on component mount
  useEffect(() => {
    const fetchBotsList = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('bots')
          .select('id, name, symbol')
          .eq('user_id', user.id)
          .order('name');
          
        if (error) throw error;
        
        setAvailableBots(data || []);
        
        // If no botId is specified, navigate to the first bot
        if (!botId && data && data.length > 0) {
          navigate(`/analytics/${data[0].id}`);
        }
      } catch (error) {
        console.error('Error fetching bots list:', error);
      }
    };
    
    fetchBotsList();
  }, [user, supabase, botId, navigate]);
  
  // Fetch bot data and trades
  useEffect(() => {
    const fetchBotData = async () => {
      if (!user || !botId) return;
      
      setLoading(true);
      
      try {
        // Fetch bot data
        const { data: botData, error: botError } = await supabase
          .from('bots')
          .select('*')
          .eq('id', botId)
          .eq('user_id', user.id)
          .single();
          
        if (botError) throw botError;
        
        setBot(botData);
        
        // Determine date filter based on timeRange
        let dateFilter;
        const now = new Date();
        switch (timeRange) {
          case '1w':
            dateFilter = format(subDays(now, 7), 'yyyy-MM-dd');
            break;
          case '1m':
            dateFilter = format(subDays(now, 30), 'yyyy-MM-dd');
            break;
          case '3m':
            dateFilter = format(subDays(now, 90), 'yyyy-MM-dd');
            break;
          case 'all':
          default:
            dateFilter = format(new Date(0), 'yyyy-MM-dd'); // Beginning of time
            break;
        }
        
        // Fetch trades
        let tradesQuery = supabase
          .from('trades')
          .select('*')
          .eq('bot_id', botId)
          .eq('user_id', user.id)
          .gte('created_at', dateFilter)
          .order('created_at');
          
        const { data: tradesData, error: tradesError } = await tradesQuery;
        
        if (tradesError) throw tradesError;
        
        setTrades(tradesData || []);
        
        // Calculate metrics
        calculateMetrics(tradesData || []);
      } catch (error) {
        console.error('Error fetching bot data:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchBotData();
  }, [botId, user, supabase, timeRange]);
  
  // Calculate metrics based on trades
  const calculateMetrics = (trades: Trade[]) => {
    if (!trades.length) {
      setMetrics({
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakEvenTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        netProfit: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
      });
      return;
    }
    
    // Initialize metric variables
    let winningTrades = 0;
    let losingTrades = 0;
    let breakEvenTrades = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let largestWin = 0;
    let largestLoss = 0;
    let netProfit = 0;
    
    // Helper for drawdown calculation
    let peak = 0;
    let drawdown = 0;
    let maxDrawdown = 0;
    let equity = 0;
    
    // Calculate daily returns for Sharpe ratio
    const dailyReturns: number[] = [];
    let currentDay = '';
    let dailyReturn = 0;
    
    // Sort trades by date
    const sortedTrades = [...trades].sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    // Process each trade
    sortedTrades.forEach(trade => {
      const pnl = trade.realized_pnl || 0;
      netProfit += pnl;
      
      // Win/loss stats
      if (pnl > 0) {
        winningTrades++;
        totalWins += pnl;
        if (pnl > largestWin) largestWin = pnl;
      } else if (pnl < 0) {
        losingTrades++;
        totalLosses += Math.abs(pnl);
        if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl);
      } else {
        breakEvenTrades++;
      }
      
      // Drawdown calculation
      equity += pnl;
      if (equity > peak) {
        peak = equity;
        drawdown = 0;
      } else {
        drawdown = peak - equity;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
      
      // Accumulate daily returns for Sharpe ratio
      const tradeDay = format(new Date(trade.created_at), 'yyyy-MM-dd');
      if (tradeDay !== currentDay) {
        if (currentDay) {
          dailyReturns.push(dailyReturn);
        }
        currentDay = tradeDay;
        dailyReturn = pnl;
      } else {
        dailyReturn += pnl;
      }
    });
    
    // Add the last day's return
    if (dailyReturn !== 0) {
      dailyReturns.push(dailyReturn);
    }
    
    // Calculate risk-adjusted metrics
    const avgDailyReturn = dailyReturns.reduce((sum, val) => sum + val, 0) / (dailyReturns.length || 1);
    const stdDevDailyReturn = Math.sqrt(
      dailyReturns.reduce((sum, val) => sum + Math.pow(val - avgDailyReturn, 2), 0) / (dailyReturns.length || 1)
    );
    
    // Calculate Sharpe ratio (assuming risk-free rate = 0)
    const sharpeRatio = stdDevDailyReturn ? (avgDailyReturn / stdDevDailyReturn) * Math.sqrt(252) : 0; // Annualized
    
    // Calculate derived metrics
    const winRate = trades.length ? (winningTrades / trades.length) * 100 : 0;
    const avgWin = winningTrades ? totalWins / winningTrades : 0;
    const avgLoss = losingTrades ? totalLosses / losingTrades : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    
    // Update metrics state
    setMetrics({
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      breakEvenTrades,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      profitFactor,
      netProfit,
      sharpeRatio,
      maxDrawdown,
    });
  };
  
  // Prepare chart data for equity curve
  const prepareEquityCurveData = () => {
    if (!trades.length) return null;
    
    // Sort trades by date
    const sortedTrades = [...trades].sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    // Generate equity curve
    let equity = 0;
    const labels: string[] = [];
    const data: number[] = [];
    
    sortedTrades.forEach(trade => {
      equity += trade.realized_pnl || 0;
      labels.push(format(new Date(trade.created_at), 'MMM dd'));
      data.push(equity);
    });
    
    return {
      labels,
      datasets: [
        {
          label: 'Equity Curve',
          data,
          borderColor: 'rgba(59, 130, 246, 1)', // Blue
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4,
        }
      ]
    };
  };
  
  // Prepare chart data for win/loss distribution
  const prepareWinLossDistributionData = () => {
    if (!trades.length) return null;
    
    // Group trades by day
    const tradesByDay: Record<string, {wins: number, losses: number}> = {};
    
    trades.forEach(trade => {
      const day = format(new Date(trade.created_at), 'MMM dd');
      
      if (!tradesByDay[day]) {
        tradesByDay[day] = { wins: 0, losses: 0 };
      }
      
      if (trade.realized_pnl && trade.realized_pnl > 0) {
        tradesByDay[day].wins++;
      } else if (trade.realized_pnl && trade.realized_pnl < 0) {
        tradesByDay[day].losses++;
      }
    });
    
    const labels = Object.keys(tradesByDay).slice(-14); // Show last 14 days
    const winData = labels.map(day => tradesByDay[day]?.wins || 0);
    const lossData = labels.map(day => tradesByDay[day]?.losses || 0);
    
    return {
      labels,
      datasets: [
        {
          label: 'Wins',
          data: winData,
          backgroundColor: 'rgba(34, 197, 94, 0.7)', // Green
        },
        {
          label: 'Losses',
          data: lossData,
          backgroundColor: 'rgba(239, 68, 68, 0.7)', // Red
        }
      ]
    };
  };
  
  // Prepare chart data for PnL by trade
  const preparePnlByTradeData = () => {
    if (!trades.length) return null;
    
    // Sort trades by date
    const sortedTrades = [...trades].sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    
    const labels = sortedTrades.map((_, index) => `Trade ${index + 1}`);
    const data = sortedTrades.map(trade => trade.realized_pnl || 0);
    
    return {
      labels,
      datasets: [
        {
          label: 'PnL per Trade',
          data,
          backgroundColor: data.map(value => value >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
        }
      ]
    };
  };
  
  const equityCurveData = prepareEquityCurveData();
  const winLossDistributionData = prepareWinLossDistributionData();
  const pnlByTradeData = preparePnlByTradeData();

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center">
          <BarChart3 className="mr-2" />
          Bot Analytics
        </h1>
        
        {availableBots.length > 0 && (
          <div className="flex items-center">
            <label htmlFor="botSelect" className="mr-2 text-sm text-gray-700">
              Select Bot:
            </label>
            <select
              id="botSelect"
              value={botId}
              onChange={(e) => navigate(`/analytics/${e.target.value}`)}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              {availableBots.map(bot => (
                <option key={bot.id} value={bot.id}>{bot.name} ({bot.symbol})</option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw size={32} className="text-blue-600 animate-spin" />
        </div>
      ) : !bot ? (
        <div className="bg-white p-8 rounded-lg shadow-sm text-center">
          <p className="text-gray-500">No bot selected or bot not found</p>
        </div>
      ) : (
        <>
          {/* Bot header */}
          <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
            <div className="flex flex-wrap items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{bot.name}</h2>
                <p className="text-gray-600">Symbol: {bot.symbol}</p>
              </div>
              
              <div className="mt-4 md:mt-0">
                <div className="inline-flex bg-gray-100 rounded-lg overflow-hidden">
                  {(['1w', '1m', '3m', 'all'] as TimeRange[]).map((range) => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={`px-4 py-2 text-sm ${
                        timeRange === range 
                          ? 'bg-blue-600 text-white' 
                          : 'text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {range === '1w' ? '1 Week' :
                       range === '1m' ? '1 Month' :
                       range === '3m' ? '3 Months' : 'All Time'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          
          {/* Performance metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-center mb-2">
                <DollarSign size={18} className="text-blue-600 mr-2" />
                <h3 className="text-sm font-medium text-gray-500">Net Profit</h3>
              </div>
              <div className={`text-2xl font-bold ${metrics.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {metrics.netProfit.toFixed(2)} USDT
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-center mb-2">
                <Percent size={18} className="text-blue-600 mr-2" />
                <h3 className="text-sm font-medium text-gray-500">Win Rate</h3>
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {metrics.winRate.toFixed(1)}%
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-center mb-2">
                <TrendingUp size={18} className="text-green-600 mr-2" />
                <h3 className="text-sm font-medium text-gray-500">Profit Factor</h3>
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-center mb-2">
                <TrendingDown size={18} className="text-red-600 mr-2" />
                <h3 className="text-sm font-medium text-gray-500">Max Drawdown</h3>
              </div>
              <div className="text-2xl font-bold text-red-600">
                {metrics.maxDrawdown.toFixed(2)} USDT
              </div>
            </div>
          </div>
          
          {/* Detailed metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Trade Statistics</h3>
              <div className="grid grid-cols-2 gap-y-4">
                <div>
                  <p className="text-sm text-gray-500">Total Trades</p>
                  <p className="text-lg font-medium">{metrics.totalTrades}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Winning Trades</p>
                  <p className="text-lg font-medium text-green-600">{metrics.winningTrades}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Losing Trades</p>
                  <p className="text-lg font-medium text-red-600">{metrics.losingTrades}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Break-Even Trades</p>
                  <p className="text-lg font-medium text-gray-600">{metrics.breakEvenTrades}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Average Win</p>
                  <p className="text-lg font-medium text-green-600">{metrics.avgWin.toFixed(2)} USDT</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Average Loss</p>
                  <p className="text-lg font-medium text-red-600">{metrics.avgLoss.toFixed(2)} USDT</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Largest Win</p>
                  <p className="text-lg font-medium text-green-600">{metrics.largestWin.toFixed(2)} USDT</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Largest Loss</p>
                  <p className="text-lg font-medium text-red-600">{metrics.largestLoss.toFixed(2)} USDT</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Risk Metrics</h3>
              <div className="grid grid-cols-2 gap-y-4">
                <div>
                  <p className="text-sm text-gray-500">Sharpe Ratio</p>
                  <p className="text-lg font-medium">{metrics.sharpeRatio.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Win/Loss Ratio</p>
                  <p className="text-lg font-medium">
                    {metrics.avgLoss ? (metrics.avgWin / metrics.avgLoss).toFixed(2) : metrics.avgWin ? '∞' : '0.00'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Max Drawdown</p>
                  <p className="text-lg font-medium text-red-600">{metrics.maxDrawdown.toFixed(2)} USDT</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Max Drawdown %</p>
                  <p className="text-lg font-medium text-red-600">
                    {metrics.netProfit + metrics.maxDrawdown > 0 
                      ? ((metrics.maxDrawdown / (metrics.netProfit + metrics.maxDrawdown)) * 100).toFixed(2) 
                      : '0.00'}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Expected Value</p>
                  <p className="text-lg font-medium">
                    {((metrics.winRate / 100) * metrics.avgWin - ((100 - metrics.winRate) / 100) * metrics.avgLoss).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">First Trade</p>
                  <p className="text-lg font-medium">
                    {trades.length ? format(new Date(trades[0].created_at), 'MMM dd, yyyy') : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Charts */}
          <div className="grid grid-cols-1 gap-6 mb-6">
            {/* Equity Curve */}
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Equity Curve</h3>
              <div className="h-64">
                {equityCurveData ? (
                  <Line 
                    data={equityCurveData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'top',
                        },
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              return `Equity: ${context.parsed.y.toFixed(2)} USDT`;
                            }
                          }
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: false,
                          ticks: {
                            callback: function(value) {
                              return `${value} USDT`;
                            }
                          }
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500">No trade data available</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* Win/Loss Distribution */}
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Win/Loss Distribution</h3>
              <div className="h-64">
                {winLossDistributionData ? (
                  <Bar 
                    data={winLossDistributionData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'top',
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            precision: 0
                          }
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500">No trade data available</p>
                  </div>
                )}
              </div>
            </div>
            
            {/* PnL by Trade */}
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold mb-4">PnL by Trade</h3>
              <div className="h-64">
                {pnlByTradeData ? (
                  <Bar 
                    data={pnlByTradeData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'top',
                        },
                        tooltip: {
                          callbacks: {
                            label: function(context) {
                              return `PnL: ${context.parsed.y.toFixed(2)} USDT`;
                            }
                          }
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: false,
                          ticks: {
                            callback: function(value) {
                              return `${value} USDT`;
                            }
                          }
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500">No trade data available</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Analytics;