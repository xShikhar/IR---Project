import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/browser',timeout:90_000,expect:{timeout:20_000},workers:1,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:3101',channel:'msedge',headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node server/src/api/server.js',url:'http://127.0.0.1:3101/api/health',reuseExistingServer:true,timeout:60_000},
});
