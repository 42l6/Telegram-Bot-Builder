module.exports = {
  apps: [
    {
      name: 'telegram-bot',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_file: 'logs/pm2-combined.log',
      time: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '5s',
    },
  ],
};
