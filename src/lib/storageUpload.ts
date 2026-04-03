import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

const STORAGE_BUCKET = "reports";
const PATH_PREFIX = "daily";

/**
 * Supabase Storage 클라이언트 — lazy singleton.
 * 환경변수가 없으면 null을 반환한다.
 */
let _client: SupabaseClient | null = null;

function getStorageClient(): SupabaseClient | null {
  if (_client != null) {
    return _client;
  }

  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_KEY"];

  if (supabaseUrl == null || supabaseUrl === "") {
    return null;
  }
  if (serviceKey == null || serviceKey === "") {
    return null;
  }

  _client = createClient(supabaseUrl, serviceKey);
  return _client;
}

/**
 * 테스트에서 singleton 상태를 리셋하기 위한 내부 함수.
 * 프로덕션 코드에서는 호출하지 않는다.
 */
export function _resetStorageClientForTest(): void {
  _client = null;
}

/**
 * 파일 경로를 생성한다.
 * 형식: daily/{date}/{filename}.html
 */
export function buildStoragePath(date: string, filename: string): string {
  return `${PATH_PREFIX}/${date}/${filename}.html`;
}

/**
 * HTML 리포트를 Supabase Storage에 업로드한다.
 *
 * - SUPABASE_URL 또는 SUPABASE_SERVICE_KEY가 미설정이면 null 반환 (fail-open)
 * - 업로드 실패 시 null 반환 — 절대 throw하지 않음 (Gist fallback이 동작해야 함)
 * - 성공 시 퍼블릭 URL 반환
 *
 * @param html      업로드할 HTML 문자열
 * @param date      날짜 문자열 (YYYY-MM-DD 형식, 경로에 사용)
 * @param filename  파일명 (확장자 제외). 기본값: `report-{date}`
 */
export async function uploadHtmlReport(
  html: string,
  date: string,
  filename?: string,
): Promise<string | null> {
  const resolvedFilename = filename ?? `report-${date}`;
  const client = getStorageClient();

  if (client == null) {
    logger.warn(
      "StorageUpload",
      "SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 미설정 — 스토리지 업로드 건너뜀",
    );
    return null;
  }

  const path = buildStoragePath(date, resolvedFilename);

  const { error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(path, Buffer.from(html, "utf-8"), {
      contentType: "text/html",
      upsert: true,
    });

  if (error != null) {
    logger.error("StorageUpload", `업로드 실패 (${path}): ${error.message}`);
    return null;
  }

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = data.publicUrl;

  logger.info("StorageUpload", `업로드 완료: ${publicUrl}`);
  return publicUrl;
}
