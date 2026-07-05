import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')

function inject(html, data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return html.replace('/*__DATA__*/null', json)
}

export async function serve(data, { port = 4177, open = true, page = 'dashboard.html' } = {}) {
  const html = inject(await readFile(join(APP_DIR, page), 'utf8'), data)

  const server = createServer((req, res) => {
    if (req.url === '/data.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })

  const finalPort = await listen(server, port)
  const url = `http://localhost:${finalPort}`
  if (open) openBrowser(url)
  return { url, server }
}

function listen(server, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempts > 0) {
        resolve(listen(server, port + 1, attempts - 1))
      } else reject(err)
    })
    server.listen(port, '127.0.0.1', () => resolve(port))
  })
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', url] : [url]
  execFile(cmd, args, () => {})
}
