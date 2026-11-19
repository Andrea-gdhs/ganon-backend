<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Evaluaciones de proveedores

Las rutas de evaluación requieren un token Bearer de Keycloak. Configura
`KEYCLOAK_URL`, `KEYCLOAK_REALM` y `KEYCLOAK_CLIENT_ID` (o `KEYCLOAK_ISSUER`),
además de los datos de conexión de PostgreSQL. Las llamadas del navegador usan
`apiUrl` en `portal-ganon-angular/src/environments/environment.ts`; configura
`FRONTEND_ORIGINS` como una lista separada por comas para permitir los orígenes
del portal.

Aplica manualmente `migrations/20260603_add_received_item_id.sql` y
`migrations/20261118_add_supplier_commitment_responses.sql` a la base de datos.
El backend mantiene `synchronize: false` y no ejecuta migraciones al arrancar.
Compras (incluidos los roles Keycloak `auxiliar` y `auxiliar_compras`) selecciona
los compromisos al crear una evaluación. El proveedor puede aceptarlos con una
firma digital y comentario, o solicitar una revisión; los borradores con
compromisos asignados aparecen en su bandeja. Las firmas PNG se guardan bajo `EVALUATION_FILES_DIR` (por defecto
`storage/evaluations`), que debe persistir y estar respaldado junto con la base.
Calidad, facturación y devoluciones siguen pendientes de una fuente de datos;
por ello las evaluaciones nuevas se guardan como borrador sin calificación final.

## Administración de proveedores

El módulo **Proveedores** permite a un administrador registrar un proveedor en
PostgreSQL y crear automáticamente su cuenta en Keycloak. El correo se usa como
nombre de usuario cuando se proporciona. Si se omite, se genera un nombre de
usuario con el formato `proveedor-<UUID>` y se muestra al administrador al
terminar el registro. La contraseña capturada se crea como temporal; Keycloak
obliga a cambiarla al primer acceso. La contraseña temporal no se guarda en
PostgreSQL ni se devuelve por la API después del registro.
El realm debe permitir nombres de usuario que no sean correos para registrar
proveedores sin correo.

Para habilitar la creación, configura en el entorno del backend
`KEYCLOAK_ADMIN_CLIENT_ID` y `KEYCLOAK_ADMIN_CLIENT_SECRET` para un cliente de
servicio con flujo `client_credentials` habilitado. Asígnale en el cliente
`realm-management` los permisos `manage-users` y `view-realm`. El cliente se
autentica en `KEYCLOAK_ADMIN_REALM` (por defecto, el mismo valor de
`KEYCLOAK_REALM`) y administra usuarios en `KEYCLOAK_REALM`. El rol de proveedor
se obtiene de `KEYCLOAK_PROVIDER_ROLE` (por defecto, `proveedor`; también se
acepta el rol `provider` si ese es el nombre existente). Mantén el secreto
únicamente en el entorno del backend; nunca lo configures en Angular.

El ID de NetSuite es opcional al crear el proveedor y puede actualizarse después
desde el mismo módulo. La cuenta de Keycloak queda vinculada en `portal_users`
con el ID interno de `suppliers`; el ID externo de NetSuite se almacena en
`suppliers.netsuite_vendor_id`. El administrador también puede editar los datos
del proveedor; al cambiar el correo, se actualizan el correo y el nombre de
usuario en Keycloak. La acción **Eliminar** es una desactivación lógica: se
deshabilitan el proveedor y su cuenta de Keycloak sin borrar sus órdenes ni
evaluaciones. El proveedor puede reactivarse desde el mismo módulo.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It installs `@nestjs/observe`, wires it into `AppModule` and `main.ts`, and writes the app key and secret into `.env`, which every `nest start` script (`start`, `start:dev`, `start:debug`) then loads. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/sdk) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
