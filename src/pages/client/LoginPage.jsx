import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import dragonLogo from '../../assets/dragon-logo.png';

const LoginPage = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  // Tab state: 'login' or 'register'
  const [activeTab, setActiveTab] = useState('login');

  // Login form
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginShowPw, setLoginShowPw] = useState(false);

  // Register form
  const [regUsername, setRegUsername] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regShowPw, setRegShowPw] = useState(false);

  // UI state
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Login Handler ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!loginUsername.trim()) {
      setError('Vui lòng nhập tên đăng nhập.');
      return;
    }
    if (!loginPassword) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await login(loginUsername, loginPassword);
      setSuccess(`Chào mừng ${session.displayName}!`);
      setTimeout(() => {
        if (session.role === 'admin') {
          navigate('/admin');
        } else {
          navigate('/');
        }
      }, 600);
    } catch (err) {
      setError(err.message || 'Đăng nhập thất bại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Register Handler ---
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!regUsername.trim()) {
      setError('Vui lòng nhập tên đăng nhập.');
      return;
    }
    if (!regAge) {
      setError('Vui lòng nhập tuổi.');
      return;
    }
    if (!regPassword) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }
    if (regPassword !== regConfirm) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setIsSubmitting(true);
    try {
      await register(regUsername, regAge, regPassword);
      setSuccess('Tạo tài khoản thành công! Hãy đăng nhập.');
      // Auto switch to login tab after 1s
      setTimeout(() => {
        setActiveTab('login');
        setLoginUsername(regUsername.trim());
        setLoginPassword('');
        setRegUsername('');
        setRegAge('');
        setRegPassword('');
        setRegConfirm('');
        setError('');
        setSuccess('');
      }, 1200);
    } catch (err) {
      setError(err.message || 'Đăng ký thất bại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* Animated Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-amber-500/10 via-neon-red/5 to-purple-600/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        
        {/* Card */}
        <div className="bg-[#161a2e]/90 backdrop-blur-xl rounded-3xl border border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.8)] overflow-hidden">
          
          {/* Header with Logo */}
          <div className="text-center pt-8 pb-4 px-6">
            <Link to="/" className="inline-block">
              <img 
                src={dragonLogo} 
                alt="Dragon Logo" 
                className="w-20 h-20 mx-auto object-contain drop-shadow-[0_0_25px_rgba(255,255,255,0.9)] hover:scale-110 transition-transform duration-300"
              />
            </Link>
            <div className="mt-3">
              <h1 className="text-3xl font-extrabold tracking-tight">
                <span className="text-amber-400">210</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-neon-red to-orange-500">LOLIPHIM</span>
              </h1>
              <p className="text-amber-400/80 text-[11px] font-bold mt-1 tracking-wide">
                Tích cực quay tay – Vận may sẽ đến
              </p>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex mx-6 mb-1 bg-[#0d0f1a] rounded-xl p-1 border border-white/5">
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2.5 rounded-lg text-xs font-extrabold tracking-wide transition-all duration-300 cursor-pointer ${
                activeTab === 'login'
                  ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-black shadow-[0_4px_15px_rgba(245,158,11,0.4)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              🔑 Đăng Nhập
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('register'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2.5 rounded-lg text-xs font-extrabold tracking-wide transition-all duration-300 cursor-pointer ${
                activeTab === 'register'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-500 text-black shadow-[0_4px_15px_rgba(52,211,153,0.4)]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              ✨ Đăng Ký
            </button>
          </div>

          {/* Error / Success Messages */}
          <div className="px-6 mt-3">
            {error && (
              <div className="px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2 animate-[fadeIn_0.3s_ease]">
                <span className="text-base">⚠️</span>
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2 animate-[fadeIn_0.3s_ease]">
                <span className="text-base">✅</span>
                <span>{success}</span>
              </div>
            )}
          </div>

          {/* Form Content */}
          <div className="p-6 pt-4">
            {/* === LOGIN TAB === */}
            {activeTab === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4 animate-[fadeIn_0.3s_ease]">
                
                {/* Username */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Tên đăng nhập
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">👤</span>
                    <input
                      type="text"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="Nhập username..."
                      autoComplete="username"
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-[#0d0f1a] border border-white/10 text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:border-amber-400 focus:bg-[#111425] transition-all"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔒</span>
                    <input
                      type={loginShowPw ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Nhập mật khẩu..."
                      autoComplete="current-password"
                      className="w-full py-3 pl-10 pr-12 rounded-xl bg-[#0d0f1a] border border-white/10 text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:border-amber-400 focus:bg-[#111425] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setLoginShowPw(!loginShowPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs cursor-pointer transition-colors"
                      tabIndex={-1}
                    >
                      {loginShowPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-sm uppercase tracking-wider shadow-[0_4px_20px_rgba(245,158,11,0.5)] hover:shadow-[0_6px_30px_rgba(245,158,11,0.7)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      <span>Đang xử lý...</span>
                    </>
                  ) : (
                    <span>Đăng Nhập</span>
                  )}
                </button>

                {/* Switch hint */}
                <p className="text-center text-[11px] text-gray-500 pt-1">
                  Chưa có tài khoản?{' '}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('register'); setError(''); setSuccess(''); }}
                    className="text-amber-400 font-bold hover:underline cursor-pointer"
                  >
                    Đăng ký ngay
                  </button>
                </p>
              </form>
            )}

            {/* === REGISTER TAB === */}
            {activeTab === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4 animate-[fadeIn_0.3s_ease]">

                {/* Username */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Tên đăng nhập
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">👤</span>
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => setRegUsername(e.target.value)}
                      placeholder="Chọn tên đăng nhập..."
                      autoComplete="username"
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-[#0d0f1a] border border-white/10 text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:bg-[#111425] transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-gray-600 pl-1">Chữ cái, số và dấu gạch dưới, tối thiểu 3 ký tự</p>
                </div>

                {/* Age */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Tuổi
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🎂</span>
                    <input
                      type="number"
                      value={regAge}
                      onChange={(e) => setRegAge(e.target.value)}
                      placeholder="Nhập tuổi..."
                      min="1"
                      max="120"
                      className="w-full py-3 pl-10 pr-4 rounded-xl bg-[#0d0f1a] border border-white/10 text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:bg-[#111425] transition-all"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔒</span>
                    <input
                      type={regShowPw ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự..."
                      autoComplete="new-password"
                      className="w-full py-3 pl-10 pr-12 rounded-xl bg-[#0d0f1a] border border-white/10 text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-400 focus:bg-[#111425] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setRegShowPw(!regShowPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs cursor-pointer transition-colors"
                      tabIndex={-1}
                    >
                      {regShowPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                    Xác nhận mật khẩu
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔐</span>
                    <input
                      type={regShowPw ? 'text' : 'password'}
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Nhập lại mật khẩu..."
                      autoComplete="new-password"
                      className={`w-full py-3 pl-10 pr-4 rounded-xl bg-[#0d0f1a] border text-white text-base sm:text-sm placeholder-gray-500 focus:outline-none focus:bg-[#111425] transition-all ${
                        regConfirm && regConfirm !== regPassword
                          ? 'border-red-500/50 focus:border-red-500'
                          : regConfirm && regConfirm === regPassword
                            ? 'border-emerald-500/50 focus:border-emerald-500'
                            : 'border-white/10 focus:border-emerald-400'
                      }`}
                    />
                    {regConfirm && (
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm">
                        {regConfirm === regPassword ? '✅' : '❌'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-black font-black text-sm uppercase tracking-wider shadow-[0_4px_20px_rgba(52,211,153,0.5)] hover:shadow-[0_6px_30px_rgba(52,211,153,0.7)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      <span>Đang tạo...</span>
                    </>
                  ) : (
                    <span>Tạo Tài Khoản</span>
                  )}
                </button>

                {/* Switch hint */}
                <p className="text-center text-[11px] text-gray-500 pt-1">
                  Đã có tài khoản?{' '}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('login'); setError(''); setSuccess(''); }}
                    className="text-emerald-400 font-bold hover:underline cursor-pointer"
                  >
                    Đăng nhập
                  </button>
                </p>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-2">
            <div className="border-t border-white/5 pt-4">
              <p className="text-center text-[10px] text-gray-600">
                Bằng việc đăng nhập, bạn đồng ý với{' '}
                <span className="text-gray-400 hover:text-white cursor-pointer">Điều khoản sử dụng</span>
                {' '}của 210LoliPhim
              </p>
            </div>
          </div>

        </div>

        {/* Back to Home Link */}
        <div className="text-center mt-5">
          <Link to="/" className="text-xs text-gray-500 hover:text-amber-400 transition-colors font-medium">
            ← Quay về trang chủ
          </Link>
        </div>

      </div>
    </div>
  );
};

export default LoginPage;
