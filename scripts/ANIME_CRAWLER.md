# Vận hành daily anime crawler

## Nguồn và kiến trúc

Worker Node 22 chạy độc lập trên GitHub Actions, đọc metadata PhimAPI rồi dùng Firebase Admin SDK với database (default), collection movies. Không cần FastAPI, trình duyệt hoặc máy cá nhân chạy liên tục; không tải/lưu video.

Nguồn cố định: https://phimapi.com/v1/api/danh-sach/hoat-hinh?country=nhat-ban&sort_field=modified.time&sort_type=desc&page=1

Lịch tự động duyệt trang 1–10, bỏ slug trùng. Chi tiết phải khớp slug, type=hoathinh và country chứa nhat-ban; filter/sort echo sai bị từ chối. Không chuyển sang feed phim mới hoặc nguồn khác. Chuẩn hóa/đối chiếu/import dùng chung với Magic Import ở src/utils/movieImport.js; giữ schema movies và episodes dạng [{name,url}].

## Cấu hình Firebase và GitHub

1. Dùng Node 22 có bản vá mới nhất, chạy npm ci. Workflow dùng check-latest.
2. Xác nhận project CineSmart đang deploy và database (default). Cấu hình gốc chỉ đến loliphim-db; không tự tạo database/project khác.
3. Tạo service account riêng. Có thể cấp roles/datastore.viewer cho dry-run chỉ đọc; sau khi được phép ghi mới cấp roles/datastore.user hoặc custom role tương đương. Không cần Owner/Auth Admin hay sửa Security Rules; Admin SDK dùng IAM.
4. GitHub → Settings → Secrets and variables → Actions: đặt Secret FIREBASE_SERVICE_ACCOUNT_JSON là toàn bộ JSON key, Variable FIREBASE_PROJECT_ID trùng project đang deploy. Không đặt key vào VITE_*, Git hoặc log.
5. Preflight kiểm tra JSON, project, email service account và RSA PEM. Kiểm tra này không chứng minh IAM/quyền truy cập thật.
6. Khi workflow đã được đưa vào nhánh mặc định qua quy trình review, bật Actions → CineSmart Daily Japanese Anime → Run workflow, giữ dry_run=true và trang 1–10 trước.
7. Review kế hoạch đối chiếu phim cũ/quota. Chỉ sau khi được phép vận hành production mới cấp quyền writer và đặt repository Variable CRAWLER_WRITES_ENABLED=true. Khi biến thiếu/khác true, mọi lịch chạy và dispatch vẫn là dry-run; có Secret không tự bật ghi. GitHub Actions chỉ cho phép ghi từ nhánh mặc định, không từ nhánh tính năng.

Cron 30 18 * * * UTC tương ứng khoảng 01:30 Việt Nam ngày kế tiếp; GitHub có thể chạy trễ. Schedule luôn trang 1–10 và mặc định chỉ mô phỏng; dispatch cho phép chọn khoảng trong 1–10. Các writer phải dùng concurrency group cinesmart-firestore-anime-writer, cancel-in-progress=false. Secret chỉ truyền cho bước dùng Firebase. CLI cũng mặc định dry-run; yêu cầu ghi phải đặt rõ CRAWLER_DRY_RUN=false và CRAWLER_WRITES_ENABLED=true, không tự thực hiện khi chỉ chạy npm run crawl:anime.

## Kiểm thử và kiểm tra nguồn

    npm ci
    npm run test:crawler
    npm run lint
    npm run build
    npm audit

dist hiện được Git theo dõi từ cấu trúc repository cũ. Để kiểm tra build mà không sửa nó, dùng npm run build -- --outDir .build-anime-validation và xóa thư mục kiểm tra sau đó.

    npm run check:anime-source
    npm run crawl:anime -- --dry-run

Source-only đọc 10 trang và 3 chi tiết mẫu, không cần Firebase/Secret và không đọc/ghi database. CLI dry-run cần credential đọc đúng database để so khớp; không ghi movies, cursor, lease hay thống kê. Thiếu Secret kết thúc lỗi, không phải sync thành công. Truy cập được từ local không bảo đảm IP GitHub runner được chấp nhận.

test:crawler dùng fixture tổng hợp, Firestore protocol fake và kiểm tra cấu hình SDK cục bộ; không thay thế authenticated end-to-end. Nếu dùng emulator riêng, đặt FIRESTORE_EMULATOR_HOST ở loopback/cổng hợp lệ và FIREBASE_PROJECT_ID=demo-cinesmart; không dùng credential production.

## Dữ liệu cũ, chống trùng và phục hồi

Ưu tiên sourceSlug/slug, fallback tên đầy đủ/năm/phần mùa; nhiều ứng viên cần Admin đối chiếu, không fuzzy match. Phim mới có ID kkphim-{slug}; phim cũ giữ ID, createdAt, lượt xem/thích và trường tùy chỉnh. Chỉ ghi patch khi có thay đổi, không reset catalogue.

Metadata/artwork có sẵn được giữ, giá trị thiếu có thể bổ sung. sourceSync baseline giữ các chỉnh sửa Admin khác giá trị nguồn trước đó. Legacy chưa có baseline giữ country/director và nhận trạng thái/tập hiện tại từ nguồn lần đầu; cần xem dry-run vì không thể khôi phục toàn bộ lịch sử chỉnh tay. Không tự suy ra completed từ số tập.

Gộp theo đầy đủ tên tập: Tập 01/1 cùng danh tính; OVA, special, nhiều mùa, số thập phân và tên riêng không bị gộp theo chữ số đầu tiên. Không xóa tập cũ khi nguồn trả thiếu hoặc thêm cùng URL dưới tên khác. sourceUrl nhận biết link đã sửa bằng Admin; nguồn đổi slug/tên tập cần đối chiếu thủ công.

Job ở crawlerJobs/dailyJapaneseAnime lưu page/index, snapshot slug, seen, failures/attempts, stats, timestamps, owner, leaseUntil và resumeAt. Phim và cursor/counters ghi cùng transaction: lỗi trước commit không tiến cursor, mất acknowledgement sau commit tiếp tục đúng checkpoint. Lease 5 phút bảo vệ hai worker/owner cũ; kill cứng thì chờ lease hết hạn.

Mỗi request timeout 15 giây, tối đa 3 HTTP attempts cho lỗi mạng/429/5xx, một request đồng thời và nghỉ tối thiểu 750ms. Retry-After trên 30 giây hoặc 429 hết retry hoãn worker; resumeAt ngăn invocation sau gọi sớm. 401/403/451/redirect dừng ngay. Không đổi proxy hoặc vượt chống bot.

Budget worker 18 phút, workflow timeout 25 phút. Pending tiếp tục vào invocation sau. Retry detail tối đa 3 lượt bền vững, lỗi trang liên tiếp 3 invocation thành failed; lỗi được ghi nhận mà không chặn mọi job sau vĩnh viễn. Full scan 1–10 có thể bắt đầu lại để bao phủ subset thủ công gián đoạn; khoảng manual khác phải chờ job cũ hoàn tất. Không xóa phim để phục hồi.

## Theo dõi và giới hạn

Actions log/Job Summary hiển thị NEW/UPDATE/SKIP/FILTER/ERROR, trang, thời gian và thống kê phim/tập/lỗi/retry. Pending, failed, completed_with_errors đều exit 1. Xem thêm job và movies trong Firebase Console; tải lại Admin, mở chi tiết/xem phim sau lần ghi được phép. Chạy lại với dữ liệu không đổi không được thêm phim/tập hoặc ghi lại movies. Trang chủ còn phụ thuộc CMS tuyển chọn.

Một identity scan/invocation, giới hạn 10.000 phim; sau đó đọc document đích trong transaction. Phim gần 850 KB cần xử lý thủ công, không cắt tập để ghi vừa. Checkpoint và transaction retry vẫn tốn quota; theo dõi Firebase Console, không mặc định free tier luôn đủ.

## Xử lý lỗi và bảo mật

- HTTP 403/provider code 1010 có thể là Cloudflare chặn chữ ký client. Giữ User-Agent nhận diện ứng dụng; dừng khi bị từ chối. Gửi thời điểm/CF-Ray/endpoint cho chủ nguồn và yêu cầu cách truy cập được chấp thuận. Không giả trình duyệt hoặc tự đổi nguồn.
- GET / trên phimapi.com không phải health check; dùng endpoint danh sách/source-only. Không coi source-only hay mock là authenticated Firestore end-to-end.
- .env local phải nằm ngoài Git. Credential từng bị commit cần owner thu hồi/thay nếu còn hiệu lực; bỏ khỏi bản mới không xóa lịch sử. Không đưa service account key, audit/probe output hoặc database local mới vào Git.
- Giữ các database/dist đang tracked cho đến khi xác minh kế hoạch dữ liệu/triển khai riêng; ignore rule không tự bỏ tracking file cũ.
- Overrides minimatch/rimraf phải được kiểm tra cùng SDK/lint/build khi đổi lockfile. Cảnh báo Firebase Web/gRPC/Undici, Router, Vite/esbuild còn lại cần xử lý hoặc owner chấp thuận; không chạy audit fix --force hay đổi framework ngoài phạm vi.
- Magic Import chỉ báo thành công sau xác nhận Firestore; local cache không thay thế kết quả ghi cloud.

Tài liệu: [KKPhim API](https://www.kkphim2.com/api-document), [Firebase Admin](https://firebase.google.com/docs/admin/setup), [Firestore IAM](https://cloud.google.com/firestore/native/docs/security/iam), [Cloudflare 1010](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/), [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
