import { Command } from 'commander';
import { getClient, saveTokens } from '../config.js';
import { output } from '../output.js';

async function browserLogin(platformUrl: string) {
  const { chromium } = await import('playwright');

  console.error('Opening browser for login...');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  return new Promise<void>((resolve, reject) => {
    let done = false;

    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        browser.close();
        reject(new Error('Login timed out after 5 minutes'));
      }
    }, 300_000);

    // After login, the platform redirects away from /login.
    // Detect that, then fetch the NextAuth session to grab the token.
    page.on('framenavigated', async (frame) => {
      if (done || frame !== page.mainFrame()) return;
      const url = frame.url();

      // Skip login/auth pages - wait until we land on the dashboard
      if (url.includes('/login') || url.includes('/auth') || url === 'about:blank') return;

      try {
        // We're on the dashboard - session is active. Fetch it.
        const session = await page.evaluate(async () => {
          const res = await fetch('/api/auth/session');
          return res.json();
        });

        const accessToken = session?.accessToken;
        if (accessToken && !done) {
          done = true;
          saveTokens(accessToken, session.refreshToken ?? undefined);
          console.error('Login successful! Token saved.');
          clearTimeout(timeout);
          await browser.close();
          resolve();
        }
      } catch {
        // page still loading, ignore
      }
    });

    page.goto(platformUrl).catch(reject);
  });
}

export function registerAuthCommands(program: Command) {
  const auth = program.command('auth').description('Authentication');

  auth
    .command('login')
    .description('Login via browser (opens platform login page)')
    .option('--browser', 'Open browser for login', true)
    .option('--url <url>', 'Platform URL', 'https://platform.openbox.ai')
    .action(async (opts) => {
      try {
        await browserLogin(opts.url);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('profile')
    .description('Get current user profile')
    .action(async () => {
      try {
        const data = await getClient().getProfile();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('set-token <token> [refreshToken]')
    .description('Save access token (and optional refresh token) to tokens file')
    .action(async (token: string, refreshToken?: string) => {
      try {
        saveTokens(token, refreshToken);
        console.error('Token saved.');
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('refresh')
    .description('Refresh access token')
    .action(async () => {
      try {
        const data = await getClient().refreshTokens();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('change-password')
    .description('Change password')
    .requiredOption('--current <password>', 'Current password')
    .requiredOption('--new <password>', 'New password')
    .requiredOption('--org-id <orgId>', 'Organization ID')
    .action(async (opts) => {
      try {
        const data = await getClient().changePassword({
          currentPassword: opts.current,
          newPassword: opts.new,
          orgId: opts.orgId,
        });
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });

  auth
    .command('roles')
    .description('Get current user roles')
    .action(async () => {
      try {
        const data = await getClient().getUserRoles();
        output(data);
      } catch (err: any) {
        console.error(err.message || err);
        process.exit(1);
      }
    });
}
