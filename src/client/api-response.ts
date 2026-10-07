/** Read plugin JSON without leaking HTML/error bodies into the UI. */
export async function readApiResponse<T>(response: Response): Promise<T> {
  if (response.status === 404) throw new Error('Маршрут Vision Toolkit не загружен (HTTP 404). Полностью перезапустите DSH, затем обновите страницу.')
  if (response.status === 401) throw new Error('DSH требует авторизацию (HTTP 401). Откройте интерфейс из приложения DSH.')
  const text = await response.text()
  if (!text.trim()) throw new Error(`Vision Toolkit вернул пустой ответ (HTTP ${response.status}). Перезапустите DSH и повторите запрос.`)
  try { return JSON.parse(text) as T }
  catch { throw new Error(`Vision Toolkit вернул некорректный JSON (HTTP ${response.status}). Проверьте загрузку серверной части плагина.`) }
}
