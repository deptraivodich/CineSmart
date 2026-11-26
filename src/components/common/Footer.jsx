import React from 'react';
import { Link } from 'react-router-dom';
import dragonLogo from '../../assets/dragon-logo.png';

const NAV_LINKS = [
  { label: 'Trang chủ', to: '/' },
  { label: 'Kho Thể Loại', to: '/the-loai' },
  { label: 'Anime Movie', to: '/the-loai?type=movie' },
  { label: 'Mùa Đông 2026', to: '/the-loai?season=dong&year=2026' },
  { label: 'Mùa Xuân 2026', to: '/the-loai?season=xuan&year=2026' },
];

const GENRE_TAGS = [
  { label: 'Action', to: '/the-loai?genres=Action' },
  { label: 'Fantasy', to: '/the-loai?genres=Fantasy' },
  { label: 'Isekai', to: '/the-loai?genres=Isekai' },
  { label: 'Romance', to: '/the-loai?genres=Romance' },
  { label: 'Comedy', to: '/the-loai?genres=Comedy' },
  { label: 'Shounen', to: '/the-loai?genres=Shounen' },
];

const Footer = () => {
  return (
    <footer className="mt-16 border-t border-white/10 bg-[#0b0e1a] text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Sovereignty Badge, Brand, Links, Intro & Disclaimer */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
            <div className="space-y-5">
              {/* Sovereignty Pill */}
              <div>
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#5c1218]/90 border border-red-500/35 text-xs font-bold text-white shadow-sm">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#da251d] text-[#ffff00] text-[11px] leading-none">
                    ★
                  </span>
                  <span>Hoàng Sa &amp; Trường Sa là của Việt Nam!</span>
                </span>
              </div>

              {/* Brand Row */}
              <div className="flex flex-wrap items-center gap-4">
                <Link to="/" className="inline-flex items-center gap-3 group">
                  <img
                    src={dragonLogo}
                    alt="210LoliPhim Logo"
                    className="w-11 h-11 object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.7)] group-hover:scale-105 transition-transform"
                  />
                  <div className="flex flex-col">
                    <div className="flex items-center text-2xl font-black tracking-tight leading-none">
                      <span className="text-amber-400">210</span>
                      <span className="text-[#38bdf8]">LoliPhim</span>
                    </div>
                    <span className="text-[10px] font-bold text-amber-300/90 mt-1">
                      -\ Tích cực quay tay – Vận may sẽ đến /-
                    </span>
                  </div>
                </Link>

                <div className="hidden sm:block h-8 w-px bg-white/15" />

                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-gray-200 transition-all cursor-pointer"
                  title="Lên đầu trang"
                >
                  <span>↑</span>
                  <span>Lên đầu trang</span>
                </button>
              </div>

              {/* Horizontal Quick Links */}
              <nav aria-label="Liên kết nhanh" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm font-semibold text-gray-200">
                {NAV_LINKS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="hover:text-amber-400 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>

              {/* Web Intro */}
              <p className="text-xs sm:text-sm text-gray-400 leading-relaxed max-w-2xl">
                210LoliPhim — Khám phá kho anime Nhật Bản và hoạt hình đặc sắc với nhiều lựa chọn Vietsub, Thuyết Minh, Lồng Tiếng. Xem ngay không cần đăng ký, hoặc đăng nhập để đồng bộ lịch sử xem và bình luận cùng cộng đồng.
              </p>

              {/* Disclaimer */}
              <p className="text-[11px] sm:text-xs text-gray-500 leading-relaxed max-w-2xl border-t border-white/10 pt-4">
                © {new Date().getFullYear()} 210LoliPhim. Website hoạt động phi thương mại với vai trò chỉ mục và tổng hợp liên kết công khai từ Internet; chúng tôi không trực tiếp lưu trữ tệp video trên máy chủ riêng. Nếu có bất kỳ vấn đề nào liên quan đến bản quyền hoặc quyền lợi hợp pháp, vui lòng liên hệ để chúng tôi rà soát và gỡ bỏ liên kết kịp thời.
              </p>
            </div>
          </div>

          {/* Right Column: Web Experience Card (No App Store / Google Play) */}
          <div className="lg:col-span-5">
            <div className="h-full rounded-2xl bg-gradient-to-b from-[#171c33] to-[#0e1222] border border-white/10 p-6 flex flex-col justify-between items-center text-center space-y-5 shadow-xl">
              <div className="space-y-2">
                <h3 className="text-sm sm:text-base font-black uppercase tracking-wide text-white leading-snug">
                  Xem Anime Mượt Mà Trực Tiếp Trên Trình Duyệt Web
                </h3>
                <p className="text-xs text-gray-400">
                  Hỗ trợ máy tính, điện thoại và TV — chọn nhanh thể loại yêu thích bên dưới.
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {GENRE_TAGS.map((genre) => (
                  <Link
                    key={genre.label}
                    to={genre.to}
                    className="px-3.5 py-1.5 rounded-full bg-[#222847] hover:bg-amber-400/20 border border-white/10 hover:border-amber-400/40 text-xs font-bold text-gray-200 hover:text-amber-300 transition-all"
                  >
                    {genre.label}
                  </Link>
                ))}
              </div>

              <div className="pt-2 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2.5">
                  <img
                    src={dragonLogo}
                    alt="210LoliPhim"
                    className="w-10 h-10 object-contain drop-shadow-[0_0_16px_rgba(56,189,248,0.6)]"
                  />
                  <span className="text-2xl font-black tracking-tight">
                    <span className="text-amber-400">210</span>
                    <span className="text-[#38bdf8]">LoliPhim</span>
                  </span>
                </div>
                <Link
                  to="/the-loai"
                  className="px-5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-xs shadow-md transition-all"
                >
                  Khám Phá Kho Phim
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
