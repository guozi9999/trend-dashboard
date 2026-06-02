export async function fetchJsonWithRetry<T>(url: URL, referer: string, label: string): Promise<T> {
  let response: Response
  try {
    response = await fetchWithRetry(url, {
      headers: {
        Referer: referer,
        'User-Agent': 'Mozilla/5.0 trend-dashboard'
      }
    })
  } catch (error) {
    throw createError({
      statusCode: 502,
      message: `${label}请求失败：${getErrorMessage(error)}`
    })
  }

  if (!response.ok) {
    throw createError({ statusCode: 502, message: `${label}请求失败：${response.status}` })
  }

  return await response.json() as T
}

async function fetchWithRetry(url: URL, init: RequestInit, retries = 2): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(300 * (attempt + 1))
      }
    }
  }

  throw lastError
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
