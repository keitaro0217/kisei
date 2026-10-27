'use client';

import { useState } from 'react';
import { usePortal } from '@/store/portalStore';
import { universities } from '@/data/dummyData';

export default function ConnectionCard() {
  const { state, startConnection, completeConnection, disconnect } = usePortal();
  const [showModal, setShowModal] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'form' | 'connecting' | 'syncing'>('form');

  const university = universities.find((u) => u.id === state.selectedUniversityId);
  const themeColor = university?.themeColor ?? '#003366';

  const handleConnect = async () => {
    setStep('connecting');
    startConnection();
    await new Promise((r) => setTimeout(r, 1500));
    setStep('syncing');
    await new Promise((r) => setTimeout(r, 1500));
    completeConnection();
    setShowModal(false);
    setStep('form');
    setUsername('');
    setPassword('');
  };

  const handleDisconnect = () => {
    disconnect();
  };

  if (state.connectionStatus === 'connected') {
    return (
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900 text-sm">{university?.portalName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              最終同期:{' '}
              {state.lastSynced
                ? `${state.lastSynced.getHours().toString().padStart(2, '0')}:${state.lastSynced.getMinutes().toString().padStart(2, '0')}`
                : '未同期'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              連携済み
            </span>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          className="mt-3 w-full py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          連携を解除
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm p-4">
        <p className="text-sm text-gray-600 mb-3">
          大学ポータルと連携することで、授業・課題・お知らせを自動で取得できます。
        </p>
        <button
          onClick={() => setShowModal(true)}
          className="w-full py-3 rounded-xl text-white text-sm font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: themeColor }}
        >
          大学ポータルと連携する
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
          <div className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-10">
            {step === 'form' && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-gray-900">
                    {university?.portalName}へのログイン
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      ユーザーID
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="例: keio_taro"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      パスワード
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="パスワードを入力"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>
                  <button
                    onClick={handleConnect}
                    className="w-full py-3 rounded-xl text-white text-sm font-bold transition-opacity hover:opacity-90 mt-2"
                    style={{ backgroundColor: themeColor }}
                  >
                    連携する
                  </button>
                </div>
              </>
            )}
            {(step === 'connecting' || step === 'syncing') && (
              <div className="flex flex-col items-center justify-center py-8 gap-4">
                <svg className="animate-spin h-10 w-10" style={{ color: themeColor }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-700 font-medium">
                  {step === 'connecting' ? 'ログイン中...' : '同期中...'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
