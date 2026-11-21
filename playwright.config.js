import { defineConfig } from '@playwright/test';

const browserChannel = process.env.TURNTRACE_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium');
const testPort = process.env.TURNTRACE_TEST_PORT ?? '3111';
const baseURL = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir:'./tests/browser',timeout:90_000,expect:{timeout:20_000},workers:1,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL,channel:browserChannel === 'chromium' ? undefined : browserChannel,headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node server/src/api/server.js',env:{PORT:testPort},url:`${baseURL}/api/health`,reuseExistingServer:false,timeout:60_000},
});
