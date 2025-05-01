import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Key, Shield, AlertTriangle, CheckCircle, XCircle, Clipboard, Plus, Trash2, Edit, AlertCircle } from 'lucide-react';
import { useSupabase } from '../contexts/SupabaseContext';
import { useAuth } from '../contexts/AuthContext';

type ApiKey = {
  id: string;
  name: string;
  api_key: string;
  api_secret: string;
  exchange: string;
  account_type: 'main' | 'sub';
  created_at: string;
  updated_at: string | null;
  is_default: boolean;
  bot_id: string | null;
};

type ApiKeyFormData = {
  id?: string;
  name: string;
  api_key: string;
  api_secret: string;
  account_type: 'main' | 'sub';
  is_default: boolean;
};

type PasswordFormData = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

const AccountSettings: React.FC = () => {
  const { supabase } = useSupabase();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [apiKeySuccess, setApiKeySuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  
  const apiKeyForm = useForm<ApiKeyFormData>({
    defaultValues: {
      name: '',
      api_key: '',
      api_secret: '',
      account_type: 'main',
      is_default: false
    }
  });
  
  const passwordForm = useForm<PasswordFormData>({
    defaultValues: {
      current_password: '',
      new_password: '',
      confirm_password: ''
    }
  });
  
  const { register: registerApiKey, handleSubmit: handleSubmitApiKey, setValue: setApiKeyValue, reset: resetApiKeyForm, watch: watchApiKey } = apiKeyForm;
  const { register: registerPassword, handleSubmit: handleSubmitPassword, reset: resetPassword, formState: { errors: passwordErrors } } = passwordForm;

  const watchIsDefault = watchApiKey('is_default');

  // Fetch API keys
  useEffect(() => {
    const fetchApiKeys = async () => {
      if (!user) return;
      
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('api_keys')
          .select('*')
          .eq('user_id', user.id)
          .eq('exchange', 'bybit')
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true });
          
        if (error) throw error;
        
        setApiKeys(data || []);
      } catch (error) {
        console.error('Error fetching API keys:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchApiKeys();
  }, [user, supabase]);

  // Setup form for editing
  const editApiKey = (keyId: string) => {
    const keyToEdit = apiKeys.find(key => key.id === keyId);
    if (!keyToEdit) return;
    
    setApiKeyValue('id', keyToEdit.id);
    setApiKeyValue('name', keyToEdit.name);
    setApiKeyValue('api_key', keyToEdit.api_key);
    setApiKeyValue('api_secret', keyToEdit.api_secret);
    setApiKeyValue('account_type', keyToEdit.account_type);
    setApiKeyValue('is_default', keyToEdit.is_default);
    
    setEditingKey(keyId);
    setIsAddingKey(true);
  };

  // Setup form for adding new key
  const addNewApiKey = () => {
    resetApiKeyForm({
      name: '',
      api_key: '',
      api_secret: '',
      account_type: 'main',
      is_default: apiKeys.length === 0 // Make default if it's the first one
    });
    
    setEditingKey(null);
    setIsAddingKey(true);
  };

  // Cancel editing/adding
  const cancelEdit = () => {
    setIsAddingKey(false);
    setEditingKey(null);
    resetApiKeyForm();
  };

  // Save API key
  const onSaveApiKey = async (data: ApiKeyFormData) => {
    if (!user) return;
    
    setSavingKeys(true);
    setApiKeySuccess(false);
    
    try {
      // If setting as default, update all other keys to not be default
      if (data.is_default) {
        // Update all other keys to not be default
        await supabase
          .from('api_keys')
          .update({ is_default: false })
          .eq('user_id', user.id)
          .eq('exchange', 'bybit');
      }
      
      if (editingKey) {
        // Update existing key
        const { error } = await supabase
          .from('api_keys')
          .update({
            name: data.name,
            api_key: data.api_key,
            api_secret: data.api_secret,
            account_type: data.account_type,
            is_default: data.is_default,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingKey)
          .eq('user_id', user.id);
          
        if (error) throw error;
      } else {
        // Insert new key
        const { error } = await supabase
          .from('api_keys')
          .insert({
            user_id: user.id,
            name: data.name,
            exchange: 'bybit',
            api_key: data.api_key,
            api_secret: data.api_secret,
            account_type: data.account_type,
            is_default: data.is_default,
            created_at: new Date().toISOString()
          });
          
        if (error) throw error;
      }
      
      // Refresh API keys
      const { data: updatedKeys, error: fetchError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('user_id', user.id)
        .eq('exchange', 'bybit')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
        
      if (fetchError) throw fetchError;
      
      setApiKeys(updatedKeys || []);
      setApiKeySuccess(true);
      setIsAddingKey(false);
      setEditingKey(null);
      
      setTimeout(() => setApiKeySuccess(false), 3000);
    } catch (error) {
      console.error('Error saving API key:', error);
      alert('Failed to save API key');
    } finally {
      setSavingKeys(false);
    }
  };

  // Delete API key
  const deleteApiKey = async (keyId: string) => {
    if (!user || !confirm('Are you sure you want to delete this API key?')) return;
    
    try {
      setDeletingKey(keyId);
      
      // Check if this key is used by any bots
      const { data: botsData, error: botsError } = await supabase
        .from('bots')
        .select('id')
        .eq('api_key_id', keyId);
        
      if (botsError) throw botsError;
      
      if (botsData && botsData.length > 0) {
        alert(`This API key is used by ${botsData.length} bot(s). Please update those bots to use a different API key first.`);
        return;
      }
      
      // Delete the key
      const { error } = await supabase
        .from('api_keys')
        .delete()
        .eq('id', keyId)
        .eq('user_id', user.id);
        
      if (error) throw error;
      
      // Remove from state
      setApiKeys(apiKeys.filter(key => key.id !== keyId));
      
    } catch (error) {
      console.error('Error deleting API key:', error);
      alert('Failed to delete API key');
    } finally {
      setDeletingKey(null);
    }
  };

  // Change password
  const onChangePassword = async (data: PasswordFormData) => {
    setSavingPassword(true);
    setPasswordSuccess(false);
    setPasswordError(null);
    
    if (data.new_password !== data.confirm_password) {
      setPasswordError('New passwords do not match');
      setSavingPassword(false);
      return;
    }
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: data.new_password
      });
      
      if (error) throw error;
      
      setPasswordSuccess(true);
      resetPassword();
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (error: any) {
      console.error('Error changing password:', error);
      setPasswordError(error.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  // Mark an API key as default
  const setAsDefault = async (keyId: string) => {
    if (!user) return;
    
    try {
      // First update all keys to not be default
      await supabase
        .from('api_keys')
        .update({ is_default: false })
        .eq('user_id', user.id)
        .eq('exchange', 'bybit');
        
      // Then set the selected key to be default
      const { error } = await supabase
        .from('api_keys')
        .update({ is_default: true })
        .eq('id', keyId)
        .eq('user_id', user.id);
        
      if (error) throw error;
      
      // Update local state
      setApiKeys(apiKeys.map(key => ({
        ...key,
        is_default: key.id === keyId
      })));
      
    } catch (error) {
      console.error('Error setting default API key:', error);
      alert('Failed to set default API key');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <RefreshCw size={32} className="text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>
      
      <div className="grid grid-cols-1 gap-8">
        {/* API Keys */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center">
              <Key className="text-blue-600 mr-2" size={20} />
              <h2 className="text-xl font-semibold">Bybit API Keys</h2>
            </div>
            
            {!isAddingKey && (
              <button 
                onClick={addNewApiKey}
                className="flex items-center text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus size={16} className="mr-1" /> Add API Key
              </button>
            )}
          </div>
          
          {apiKeys.length === 0 && !isAddingKey ? (
            <div className="bg-gray-50 rounded-md p-4 text-center">
              <p className="text-gray-500">No API keys added yet. Add your first API key to start trading.</p>
              <button 
                onClick={addNewApiKey}
                className="mt-3 flex items-center mx-auto text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
              >
                <Plus size={16} className="mr-1" /> Add API Key
              </button>
            </div>
          ) : (
            <>
              {/* API Key List */}
              {!isAddingKey && (
                <div className="space-y-4 mb-6">
                  {apiKeys.map(key => (
                    <div key={key.id} className="border rounded-md p-4 hover:shadow-sm transition-shadow">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-medium">{key.name}</div>
                          <div className="text-sm text-gray-500">
                            {key.account_type === 'sub' ? 'Sub-account' : 'Main account'}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            API Key: •••••••••••{key.api_key.substring(key.api_key.length - 5)}
                          </div>
                          <div className="text-sm text-gray-500">
                            Created: {new Date(key.created_at).toLocaleDateString()}
                          </div>
                          {key.is_default && (
                            <div className="mt-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs inline-block rounded-full">
                              Default
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {!key.is_default && (
                            <button
                              onClick={() => setAsDefault(key.id)}
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-md"
                              title="Set as Default"
                            >
                              <CheckCircle size={18} />
                            </button>
                          )}
                          <button
                            onClick={() => editApiKey(key.id)}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-md"
                            title="Edit"
                          >
                            <Edit size={18} />
                          </button>
                          <button
                            onClick={() => deleteApiKey(key.id)}
                            disabled={deletingKey === key.id}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingKey === key.id ? <RefreshCw size={18} className="animate-spin" /> : <Trash2 size={18} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* API Key Form */}
              {isAddingKey && (
                <form onSubmit={handleSubmitApiKey(onSaveApiKey)} className="border rounded-md p-4">
                  <h3 className="text-lg font-medium mb-4">{editingKey ? 'Edit API Key' : 'Add New API Key'}</h3>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Main Account"
                      {...registerApiKey('name', { required: true })}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Enter your Bybit API key"
                      {...registerApiKey('api_key', { required: true })}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">API Secret</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Enter your Bybit API secret"
                      {...registerApiKey('api_secret', { required: true })}
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      {...registerApiKey('account_type')}
                    >
                      <option value="main">Main Account</option>
                      <option value="sub">Sub Account</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Select "Sub Account" if you are using a Bybit sub-account API key.
                    </p>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="is_default"
                        className="h-4 w-4 text-blue-600 rounded"
                        {...registerApiKey('is_default')}
                      />
                      <label htmlFor="is_default" className="ml-2 block text-sm text-gray-700">
                        Set as Default API Key
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      The default API key will be used for bots that don't have a specific API key assigned.
                    </p>
                  </div>
                  
                  <div className="mb-6">
                    <div className="flex items-start p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <AlertTriangle size={16} className="text-blue-500 mr-2 mt-0.5" />
                      <p className="text-sm text-blue-700">
                        API keys are stored securely, but they can be used to execute real trades. 
                        Never enable withdrawal permissions on API keys used for this platform.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <button
                      type="submit"
                      disabled={savingKeys}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center"
                    >
                      {savingKeys ? (
                        <RefreshCw size={16} className="mr-2 animate-spin" />
                      ) : (
                        <Key size={16} className="mr-2" />
                      )}
                      {editingKey ? 'Update API Key' : 'Save API Key'}
                    </button>
                    
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    
                    {apiKeySuccess && (
                      <div className="ml-3 flex items-center text-green-600">
                        <CheckCircle size={16} className="mr-1" />
                        <span className="text-sm">API key saved successfully!</span>
                      </div>
                    )}
                  </div>
                </form>
              )}
            </>
          )}
        </div>
        
        {/* Change Password */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center mb-4">
            <Shield className="text-blue-600 mr-2" size={20} />
            <h2 className="text-xl font-semibold">Change Password</h2>
          </div>
          
          <form onSubmit={handleSubmitPassword(onChangePassword)}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                className={`w-full px-3 py-2 border rounded-md ${passwordErrors.current_password ? 'border-red-500' : 'border-gray-300'}`}
                {...registerPassword('current_password', { required: 'Current password is required' })}
              />
              {passwordErrors.current_password && (
                <p className="mt-1 text-xs text-red-600">{passwordErrors.current_password.message}</p>
              )}
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                className={`w-full px-3 py-2 border rounded-md ${passwordErrors.new_password ? 'border-red-500' : 'border-gray-300'}`}
                {...registerPassword('new_password', { 
                  required: 'New password is required',
                  minLength: { value: 8, message: 'Password must be at least 8 characters' } 
                })}
              />
              {passwordErrors.new_password && (
                <p className="mt-1 text-xs text-red-600">{passwordErrors.new_password.message}</p>
              )}
            </div>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                className={`w-full px-3 py-2 border rounded-md ${passwordErrors.confirm_password ? 'border-red-500' : 'border-gray-300'}`}
                {...registerPassword('confirm_password', { 
                  required: 'Please confirm your password',
                  validate: (value, formValues) => value === formValues.new_password || 'Passwords do not match'
                })}
              />
              {passwordErrors.confirm_password && (
                <p className="mt-1 text-xs text-red-600">{passwordErrors.confirm_password.message}</p>
              )}
            </div>
            
            <div className="flex items-center">
              <button
                type="submit"
                disabled={savingPassword}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center"
              >
                {savingPassword ? (
                  <RefreshCw size={16} className="mr-2 animate-spin" />
                ) : (
                  <Shield size={16} className="mr-2" />
                )}
                Change Password
              </button>
              
              {passwordSuccess && (
                <div className="ml-3 flex items-center text-green-600">
                  <CheckCircle size={16} className="mr-1" />
                  <span className="text-sm">Password changed successfully!</span>
                </div>
              )}
              
              {passwordError && (
                <div className="ml-3 flex items-center text-red-600">
                  <XCircle size={16} className="mr-1" />
                  <span className="text-sm">{passwordError}</span>
                </div>
              )}
            </div>
          </form>
        </div>
      
        {/* Logs Section */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center mb-4">
            <Clipboard className="text-blue-600 mr-2" size={20} />
            <h2 className="text-xl font-semibold">System Logs</h2>
          </div>
          
          <p className="text-gray-700 mb-4">
            View detailed logs of webhook executions, bot operations, and any errors that may have occurred.
            System logs can help you troubleshoot issues with your trading bots.
          </p>
          
          <button
            onClick={() => navigate('/logs')}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <Clipboard size={16} className="mr-2" />
            View System Logs
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;
