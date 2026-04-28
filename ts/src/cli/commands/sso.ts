// SSO configuration. Wraps the SsoController surface - admin tooling
// only (the CLI's regular flows use Keycloak realm credentials, not
// SSO). Generated wrapper methods come from codegen/method-names.json:
//   getSsoStatus, getSsoConfig, getSsoMetadata, configureSsoOidc,
//   configureSsoSaml, enforceSso, deleteSsoConfig, verifySsoConfig.

import { Command } from 'commander';
import { getClient } from '../config.js';
import { output } from '../output.js';
import { parseJsonInput } from '../input.js';
import { reportAndExit } from '../validators/index.js';

export function registerSsoCommands(program: Command) {
  const sso = program.command('sso').description('SSO configuration (admin)');

  sso
    .command('status')
    .description('Get SSO status (enabled / method / enforced)')
    .action(async () => {
      try {
        const data = await getClient().getSsoStatus();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('config')
    .description('Get the active SSO configuration')
    .action(async () => {
      try {
        const data = await getClient().getSsoConfig();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('get-metadata')
    .description('Get SAML SP metadata (XML or JSON depending on backend)')
    .action(async () => {
      try {
        const data = await getClient().getSsoMetadata();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('configure-oidc')
    .description('Configure OIDC SSO')
    .requiredOption('--json <json>', 'OIDC config (ConfigureOidcDto)')
    .action(async (opts) => {
      try {
        const data = await getClient().configureSsoOidc(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('configure-saml')
    .description('Configure SAML SSO')
    .requiredOption('--json <json>', 'SAML config (ConfigureSamlDto)')
    .action(async (opts) => {
      try {
        const data = await getClient().configureSsoSaml(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('enforce')
    .description('Toggle SSO enforcement')
    .requiredOption('--json <json>', 'Enforce body (EnforceSsoDto)')
    .action(async (opts) => {
      try {
        const data = await getClient().enforceSso(parseJsonInput(opts.json));
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('delete')
    .description('Delete the current SSO configuration')
    .action(async () => {
      try {
        const data = await getClient().deleteSsoConfig();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });

  sso
    .command('verify')
    .description('Verify the current SSO configuration end-to-end')
    .action(async () => {
      try {
        const data = await getClient().verifySsoConfig();
        output(data);
      } catch (err: any) {
        reportAndExit(err);
      }
    });
}
