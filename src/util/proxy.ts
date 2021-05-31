/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */

import type { Agent as HttpAgent } from 'http'
import type { Agent as HttpsAgent } from 'https'

import ProxyAgent = require('proxy-agent')

export type AgentType = {
  http?: HttpAgent
  https?: HttpsAgent
  http2?: unknown
} | false

export function getProxyAgent (proxy?: string | false): AgentType {
  if (proxy) {
    const agent = new ProxyAgent(proxy)
    return {
      http: agent,
      https: agent
    }
  }

  let agent: AgentType | undefined

  const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY
  if (httpProxy) {
    agent = agent || {}
    agent.http = new ProxyAgent(httpProxy)
  }

  const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY
  if (httpsProxy) {
    agent = agent || {}
    agent.https = new ProxyAgent(httpsProxy)
  }

  return agent || false
}
