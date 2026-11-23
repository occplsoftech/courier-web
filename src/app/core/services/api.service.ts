import { HttpClient, HttpContext, HttpContextToken, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@env/environment';
import { ApiResponse } from '../models/api-response.model';
import { Page, PageQuery } from '../models/page.model';

/**
 * Opt-in per-request marker: the error interceptor still rethrows (so a caller's own
 * `catchError` runs), it just skips the global toast. For best-effort lookups where a
 * miss is an expected, silently-handled case — not a real error the user needs to see.
 */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);

/**
 * The single HTTP seam. Every feature service goes through here, so the ApiResponse
 * envelope is unwrapped in exactly one place and the base URL / params handling is
 * uniform. Errors keep the full envelope (surfaced by the error interceptor).
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  get<T>(path: string, query?: Record<string, unknown>, context?: HttpContext): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(this.base + path, { params: toParams(query), context })
      .pipe(map((r) => r.data));
  }

  /** Paged list — returns the Page<T> envelope for tables. */
  page<T>(path: string, query?: PageQuery): Observable<Page<T>> {
    return this.http
      .get<ApiResponse<Page<T>>>(this.base + path, { params: toParams(query) })
      .pipe(map((r) => r.data));
  }

  post<T>(path: string, body: unknown, context?: HttpContext): Observable<T> {
    return this.http.post<ApiResponse<T>>(this.base + path, body, { context }).pipe(map((r) => r.data));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<ApiResponse<T>>(this.base + path, body).pipe(map((r) => r.data));
  }

  patch<T>(path: string, body: unknown, context?: HttpContext): Observable<T> {
    return this.http.patch<ApiResponse<T>>(this.base + path, body, { context }).pipe(map((r) => r.data));
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<ApiResponse<T>>(this.base + path).pipe(map((r) => r.data));
  }

  /** Raw file download (CSV export, ...) — no ApiResponse envelope to unwrap. */
  getBlob(path: string, query?: Record<string, unknown>): Observable<Blob> {
    return this.http.get(this.base + path, { params: toParams(query), responseType: 'blob' });
  }
}

function toParams(query?: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => (params = params.append(key, String(v))));
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}
