import React, { useState, useEffect } from 'react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { RefreshCw, Search, Info, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ArrowLeft, ArrowRight } from 'lucide-react';

type LogEntry = {
  id: string;
  bot_id: string | null;
  bot_name?: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  details: any;
  created_at: string;
};

const Logs: React.FC = () => {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [botFilter, setBotFilter] = useState<string>('');
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [bots, setBots] = useState<{id: string, name: string}[]>([]);
  const pageSize = 20;

  // Fetch logs whenever filters change
  useEffect(() => {
    const fetchLogs = async () => {
      if (!user) return;
      
      setLoading(true);
      try {
        // Fetch logs with pagination
        let query = supabase
          .from('logs')
          .select('*, bots:bot_id(name)', { count: 'exact' })
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .range((page - 1) * pageSize, page * pageSize - 1);
        
        // Apply filters if set
        if (levelFilter) {
          query = query.eq('level', levelFilter);
        }
        
        if (botFilter) {
          query = query.eq('bot_id', botFilter);
        }
        
        const { data, count, error } = await query;
        
        if (error) throw error;
        
        // Transform logs to include bot name
        const transformedLogs = data?.map(log => ({
          ...log,
          bot_name: log.bots?.name || 'System'
        })) || [];
        
        setLogs(transformedLogs);
        if (count !== null) setTotalCount(count);
      } catch (error) {
        console.error('Error fetching logs:', error);
      } finally {
        setLoading(false);
      }
    };
    
    const fetchBots = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('bots')
          .select('id, name')
          .eq('user_id', user.id)
          .order('name');
          
        if (error) throw error;
        
        setBots(data || []);
      } catch (error) {
        console.error('Error fetching bots:', error);
      }
    };
    
    fetchLogs();
    fetchBots();
  }, [supabase, user, page, levelFilter, botFilter]);
  
  // Filter logs based on search term
  const filteredLogs = logs.filter(log => 
    log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.bot_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.details && JSON.stringify(log.details).toLowerCase().includes(searchTerm.toLowerCase()))
  );
  
  // Toggle log details expansion
  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }));
  };
  
  // Render log level badge
  const renderLevelBadge = (level: string) => {
    switch (level) {
      case 'error':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <AlertCircle size={12} className="mr-1" />
            Error
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <AlertTriangle size={12} className="mr-1" />
            Warning
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            <Info size={12} className="mr-1" />
            Info
          </span>
        );
    }
  };
  
  // Format JSON for display
  const formatJSON = (json: any) => {
    if (!json) return 'No details';
    
    try {
      if (typeof json === 'string') {
        return JSON.stringify(JSON.parse(json), null, 2);
      } else {
        return JSON.stringify(json, null, 2);
      }
    } catch (e) {
      return String(json);
    }
  };
  
  // Calculate total pages
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">System Logs</h1>
      
      <div className="bg-white p-4 rounded-lg shadow-sm mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={18} className="text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <div className="w-40">
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">All Levels</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
            
            <div className="w-40">
              <select
                value={botFilter}
                onChange={(e) => setBotFilter(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">All Bots</option>
                {bots.map(bot => (
                  <option key={bot.id} value={bot.id}>{bot.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <RefreshCw size={32} className="text-blue-600 animate-spin" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="bg-white p-8 rounded-lg shadow-sm text-center">
          <p className="text-gray-500">No logs found</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Level
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Bot
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Message
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLogs.map((log) => (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {renderLevelBadge(log.level)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {log.bot_name || 'System'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {log.message}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.details ? (
                            <button
                              onClick={() => toggleExpand(log.id)}
                              className="flex items-center text-blue-600 hover:text-blue-800"
                            >
                              {expandedLogs[log.id] ? (
                                <>
                                  <ChevronUp size={16} className="mr-1" /> Hide Details
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={16} className="mr-1" /> Show Details
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-gray-400">No details</span>
                          )}
                        </td>
                      </tr>
                      {expandedLogs[log.id] && log.details && (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="px-6 py-4">
                            <pre className="whitespace-pre-wrap break-words text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                              {formatJSON(log.details)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white px-4 py-3 rounded-lg shadow-sm">
              <div className="flex-1 flex justify-between sm:hidden">
                <button
                  onClick={() => setPage(page > 1 ? page - 1 : 1)}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page < totalPages ? page + 1 : totalPages)}
                  disabled={page === totalPages}
                  className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing <span className="font-medium">{((page - 1) * pageSize) + 1}</span> to <span className="font-medium">{Math.min(page * pageSize, totalCount)}</span> of{' '}
                    <span className="font-medium">{totalCount}</span> results
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <button
                      onClick={() => setPage(page > 1 ? page - 1 : 1)}
                      disabled={page === 1}
                      className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Previous</span>
                      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    {/* Page numbers - only show a reasonable number of pages */}
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      // Calculate which page numbers to show
                      let pageNum = i + 1;
                      if (totalPages > 5) {
                        if (page > 3) {
                          pageNum = page - 3 + i;
                        }
                        if (page > totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        }
                      }
                      
                      // Don't show page numbers less than 1 or greater than totalPages
                      if (pageNum < 1 || pageNum > totalPages) return null;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            page === pageNum
                              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPage(page < totalPages ? page + 1 : totalPages)}
                      disabled={page === totalPages}
                      className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <span className="sr-only">Next</span>
                      <ArrowRight className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Logs;