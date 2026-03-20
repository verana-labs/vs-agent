# Changelog

## [1.9.0](https://github.com/verana-labs/vs-agent/compare/v1.8.1...v1.9.0) (2026-03-20)


### Features

* **charts:** add agentSecret support for sensitive env vars ([#366](https://github.com/verana-labs/vs-agent/issues/366)) ([2b8f3ef](https://github.com/verana-labs/vs-agent/commit/2b8f3ef9f58536e78b4a33ee10edfb50d4f4e8e1))
* default web page provide a vs agent default web ([#372](https://github.com/verana-labs/vs-agent/issues/372)) ([d11ed77](https://github.com/verana-labs/vs-agent/commit/d11ed7724ff23b56356ef654e17fa3f6688d8b8c))
* reduce examples image sizes ([#365](https://github.com/verana-labs/vs-agent/issues/365)) ([13ab858](https://github.com/verana-labs/vs-agent/commit/13ab85821841ace2b1c308b699274e7eca36348b))
* relax action menu state checking ([#362](https://github.com/verana-labs/vs-agent/issues/362)) ([94eaf8b](https://github.com/verana-labs/vs-agent/commit/94eaf8bc9b52659a4c3c623ce3a6cd574ec1156e))
* show vs-agent version in agent info endpoint ([#373](https://github.com/verana-labs/vs-agent/issues/373)) ([bfb76d3](https://github.com/verana-labs/vs-agent/commit/bfb76d326b3d58f9e51969552d5c07d8f8c8179e))


### Bug Fixes

* add body size limit to admin API ([#370](https://github.com/verana-labs/vs-agent/issues/370)) ([5beb866](https://github.com/verana-labs/vs-agent/commit/5beb86676d2da4605a0e63dbb06e68d2a67c8d91))
* bug using the same json schema credential ([#374](https://github.com/verana-labs/vs-agent/issues/374)) ([ea78183](https://github.com/verana-labs/vs-agent/commit/ea78183506385bd7d365b1c781f5fda69ed6069e))
* chart indent for resources ([#357](https://github.com/verana-labs/vs-agent/issues/357)) ([a5ae9ed](https://github.com/verana-labs/vs-agent/commit/a5ae9ed1b320e808a6e0c4a32708df8386d14524))
* **charts:** simplify helm deployment logic ([#369](https://github.com/verana-labs/vs-agent/issues/369)) ([7338da3](https://github.com/verana-labs/vs-agent/commit/7338da36c9efa424430c0078323c426d314535d9))
* improvement jsc validations ([#359](https://github.com/verana-labs/vs-agent/issues/359)) ([64978fd](https://github.com/verana-labs/vs-agent/commit/64978fdeeaa796b06985cd5fcc7d6a086ae82b87))
* reduce vs-agent docker image size ([#368](https://github.com/verana-labs/vs-agent/issues/368)) ([99d503e](https://github.com/verana-labs/vs-agent/commit/99d503e64429e2846229a8f56a340caaa564e868))
* solve problem over convertShortDate ([#360](https://github.com/verana-labs/vs-agent/issues/360)) ([021c1f3](https://github.com/verana-labs/vs-agent/commit/021c1f338323c96d4f2ef15637af768c7e2eb410))
* some more optimizations on vs-agent image size ([#371](https://github.com/verana-labs/vs-agent/issues/371)) ([1b0493f](https://github.com/verana-labs/vs-agent/commit/1b0493f447061a1aaa402c355140c71d2692b4d3))
* speed-up docker image startup ([#363](https://github.com/verana-labs/vs-agent/issues/363)) ([7966b12](https://github.com/verana-labs/vs-agent/commit/7966b127c98fa715707aa7e8a68bd417b878bce0))
* speed-up nest module loading ([#364](https://github.com/verana-labs/vs-agent/issues/364)) ([ef9561e](https://github.com/verana-labs/vs-agent/commit/ef9561ec9af174cb96cf032cd6c78e48a038edfa))
* vs-agent image (missing commit from [#371](https://github.com/verana-labs/vs-agent/issues/371)) ([de7f073](https://github.com/verana-labs/vs-agent/commit/de7f073ce966eb1f32fa6dd858c3ba301b7a87c2))

## [1.8.1](https://github.com/verana-labs/vs-agent/compare/v1.8.0...v1.8.1) (2026-02-24)


### Bug Fixes

* problem creating and search schema ([#353](https://github.com/verana-labs/vs-agent/issues/353)) ([f170f34](https://github.com/verana-labs/vs-agent/commit/f170f34b33772ae305e6720adab1d015c66c2a6f))
* update Admin Swagger API documentation ([#331](https://github.com/verana-labs/vs-agent/issues/331)) ([38a7191](https://github.com/verana-labs/vs-agent/commit/38a7191c874ab1c9e567013718bea70fb9872436))

## [1.8.0](https://github.com/verana-labs/vs-agent/compare/v1.7.3...v1.8.0) (2026-02-20)


### Features

* update base ECS schemas according to latest verifiable trust v4 ([#350](https://github.com/verana-labs/vs-agent/issues/350)) ([2520a2f](https://github.com/verana-labs/vs-agent/commit/2520a2fc3502f7ed6ab398af8f57b54a91ed6093))


### Bug Fixes

* **chatbot:** create dev version ([#347](https://github.com/verana-labs/vs-agent/issues/347)) ([969beb8](https://github.com/verana-labs/vs-agent/commit/969beb872a82d671ed3264e27bee9e133cbbaeb8))
* **chats:** add custom version ([#345](https://github.com/verana-labs/vs-agent/issues/345)) ([06ac60d](https://github.com/verana-labs/vs-agent/commit/06ac60d23dc540323d7396da5938566837fb1578))
* digestSRI calculation ([#348](https://github.com/verana-labs/vs-agent/issues/348)) ([9a1cddc](https://github.com/verana-labs/vs-agent/commit/9a1cddc5e184313cee8ba836186e2e895459f746))
* ecs schema encoding error ([91b03ef](https://github.com/verana-labs/vs-agent/commit/91b03ef0c1923c01a8bba89e8dc7d0fdd8304ad5))
* JSC parsing ([08c192f](https://github.com/verana-labs/vs-agent/commit/08c192f7219ad0a03fbcd18d8e5989f913fdcf25))
* set agentContext in WsOutboundTransport ([#352](https://github.com/verana-labs/vs-agent/issues/352)) ([a05e28a](https://github.com/verana-labs/vs-agent/commit/a05e28a2a4c641dea2574557cc63473ef25b046d))
* use verana indexer instead of blockchain API ([#349](https://github.com/verana-labs/vs-agent/issues/349)) ([f827a2b](https://github.com/verana-labs/vs-agent/commit/f827a2b2debbb424320247797884e2ca51654a13))

## [1.7.3](https://github.com/verana-labs/vs-agent/compare/v1.7.2...v1.7.3) (2026-02-16)


### Bug Fixes

* allow same version ([#339](https://github.com/verana-labs/vs-agent/issues/339)) ([9fe87d0](https://github.com/verana-labs/vs-agent/commit/9fe87d04501455178ad9af5ee53309c16d9615df))
* include devnet on urlMap ([#344](https://github.com/verana-labs/vs-agent/issues/344)) ([698b5b3](https://github.com/verana-labs/vs-agent/commit/698b5b3ba70e984787ca348ea70b623d79187721))
* upgrade chatbot demo base image ([#340](https://github.com/verana-labs/vs-agent/issues/340)) ([dd29ff3](https://github.com/verana-labs/vs-agent/commit/dd29ff3c05e209d6e9f42eb939e0aa824b2bed90))

## [1.7.2](https://github.com/verana-labs/vs-agent/compare/v1.7.1...v1.7.2) (2026-02-12)


### Bug Fixes

* add sync with main version ([#335](https://github.com/verana-labs/vs-agent/issues/335)) ([5ad461c](https://github.com/verana-labs/vs-agent/commit/5ad461c9b836926cc5c53b6c22feda0ea97f5f2e))
* docker image generation ([21a21d6](https://github.com/verana-labs/vs-agent/commit/21a21d69070b23078d428f8930792e8b3c27bf8e))
* dotenv dependency ([#333](https://github.com/verana-labs/vs-agent/issues/333)) ([7c13cc1](https://github.com/verana-labs/vs-agent/commit/7c13cc1909fde3f99506fb3de6f08da1c16360ce))
* patches on dockerfiles ([b03b138](https://github.com/verana-labs/vs-agent/commit/b03b138c4b73204612bb0f2efac926b7f20e33f2))
* properly link JSC to AnonCreds objects in Credential Type creation ([#338](https://github.com/verana-labs/vs-agent/issues/338)) ([67e0d58](https://github.com/verana-labs/vs-agent/commit/67e0d5812494a91b0190b38cb611102c6e36988c))
* scaped json schema ([#330](https://github.com/verana-labs/vs-agent/issues/330)) ([56809a8](https://github.com/verana-labs/vs-agent/commit/56809a82af3b27b2e2afb0268bfcc20c60ff24d1))

## [1.7.1](https://github.com/verana-labs/vs-agent/compare/v1.7.0...v1.7.1) (2026-01-30)


### Bug Fixes

* credential types based on JSON Schema credentials ([#325](https://github.com/verana-labs/vs-agent/issues/325)) ([c205d2f](https://github.com/verana-labs/vs-agent/commit/c205d2fd57ca0e44d89d977a7bad0e4c4e362efd))

## [1.7.0](https://github.com/verana-labs/vs-agent/compare/v1.6.0...v1.7.0) (2026-01-20)


### Features

* drop vcauthn support ([#319](https://github.com/verana-labs/vs-agent/issues/319)) ([24d662b](https://github.com/verana-labs/vs-agent/commit/24d662b97f50cf85ad949266dd548546adf155dc))


### Bug Fixes

* references to veranalabs in DockerHub ([#322](https://github.com/verana-labs/vs-agent/issues/322)) ([2a4b94e](https://github.com/verana-labs/vs-agent/commit/2a4b94e013fe8748a964647c95716c5728a8b116))
* update chart name for demo chatbot ([#320](https://github.com/verana-labs/vs-agent/issues/320)) ([eb56a6c](https://github.com/verana-labs/vs-agent/commit/eb56a6c947c9c7dfc3ca7628ffcb45d327eeb961))

## [1.6.0](https://github.com/verana-labs/vs-agent/compare/v1.5.3...v1.6.0) (2026-01-13)


### Features

* add get all VTC/JSON Schema Credentials and dynamic #whois Endpoint Update ([#263](https://github.com/verana-labs/vs-agent/issues/263)) ([c500c77](https://github.com/verana-labs/vs-agent/commit/c500c7774fbf8c01c3f86190a023ae64e5351368))
* add related JSON Schema Credential ID to credential type creati… ([#303](https://github.com/verana-labs/vs-agent/issues/303)) ([3bb1e2d](https://github.com/verana-labs/vs-agent/commit/3bb1e2d1c41a1770faef200670b70573445751d8))
* add related JSON schema, versioned trust endpoint, and anoncreds support ([#271](https://github.com/verana-labs/vs-agent/issues/271)) ([b42fbb0](https://github.com/verana-labs/vs-agent/commit/b42fbb0d9577807722eacddd460fa6f15e63d80b))
* create verifiable trust endpoint for VTC ([#249](https://github.com/verana-labs/vs-agent/issues/249)) ([4bf0e32](https://github.com/verana-labs/vs-agent/commit/4bf0e329e8e66697e42a9816dec980c06b9cbaf2))
* support issuance of VTC over DIDComm ([#270](https://github.com/verana-labs/vs-agent/issues/270)) ([cbfa878](https://github.com/verana-labs/vs-agent/commit/cbfa87863c9daab1d57b7e603b43f11531d7b245))
* Upgrade [@2060](https://github.com/2060).io/credo-ts-didcomm-mrtd 0.0.18 masterlist cache support ([#265](https://github.com/verana-labs/vs-agent/issues/265)) ([c9da927](https://github.com/verana-labs/vs-agent/commit/c9da927f48483dea20500da466013e0d1ac20dda))


### Bug Fixes

* add did:web as alternativeDid for implicit invitations ([#305](https://github.com/verana-labs/vs-agent/issues/305)) ([1c34e5f](https://github.com/verana-labs/vs-agent/commit/1c34e5f6bf293f80daeb1a5075330ee3e435a979))
* add linked-vp context and update hashing algorithm to SHA-384 ([#293](https://github.com/verana-labs/vs-agent/issues/293)) ([bccfbcd](https://github.com/verana-labs/vs-agent/commit/bccfbcd21d41504c77efb42398ba531d8bbcff8b))
* add npm latest according trusted publisher ([8f20805](https://github.com/verana-labs/vs-agent/commit/8f20805d32987b69f0c928f7130be45917b6e7c3))
* add support to legacy Ed25519VerificationKey2018 ([#258](https://github.com/verana-labs/vs-agent/issues/258)) ([84d8183](https://github.com/verana-labs/vs-agent/commit/84d8183256d4722d470d14ce23c427b748fe6723))
* allow querying anoncreds resources by object type ([#275](https://github.com/verana-labs/vs-agent/issues/275)) ([256d3e8](https://github.com/verana-labs/vs-agent/commit/256d3e8af127be06d2a4db17da55388308777b2e))
* crash when user scans credential offer invitation ([#314](https://github.com/verana-labs/vs-agent/issues/314)) ([94a3592](https://github.com/verana-labs/vs-agent/commit/94a35925bd35fcc27a39601e707b447c86319095))
* credential key generation logic and improve naming clarity ([#254](https://github.com/verana-labs/vs-agent/issues/254)) ([048bb92](https://github.com/verana-labs/vs-agent/commit/048bb926a58e7b468524044bee69af3aad4855f5))
* DID Update Flow to Conditionally Refresh Services and Remove Legacy Verification Methods ([#273](https://github.com/verana-labs/vs-agent/issues/273)) ([1bfa58b](https://github.com/verana-labs/vs-agent/commit/1bfa58b74792537f18c6345445f2ef0134e05ab1))
* fixed dev version for vs agent chart ([8694547](https://github.com/verana-labs/vs-agent/commit/86945479ce6d527585601cc33640c7a76a14ec0f))
* handle self credentials lifecycle and prevent duplicate services ([#266](https://github.com/verana-labs/vs-agent/issues/266)) ([ba72e45](https://github.com/verana-labs/vs-agent/commit/ba72e453ad9aaaed0cdc9e3d19afc9c79f8f2a26))
* implicit invitation to legacy did:web won't autorespond ([#310](https://github.com/verana-labs/vs-agent/issues/310)) ([1b62d88](https://github.com/verana-labs/vs-agent/commit/1b62d88b6840dac84a04452f23cced761a2f2d30))
* improvement remove credential and jsonschema ([#257](https://github.com/verana-labs/vs-agent/issues/257)) ([87ab904](https://github.com/verana-labs/vs-agent/commit/87ab904707651520bf7d8fe6d314e7a31d89c0e0))
* include dids update ([#267](https://github.com/verana-labs/vs-agent/issues/267)) ([51dc286](https://github.com/verana-labs/vs-agent/commit/51dc28678e5f138ca5aae1c9a507dc9af6a564fc))
* problem when alternativeDids not exists ([#312](https://github.com/verana-labs/vs-agent/issues/312)) ([b036c95](https://github.com/verana-labs/vs-agent/commit/b036c95bb0501d2acadbd4970a1e3d7bbe5fed92))
* refactor self permission for testing porpose ([#281](https://github.com/verana-labs/vs-agent/issues/281)) ([9b09186](https://github.com/verana-labs/vs-agent/commit/9b091867d14576b29ddd707a98c2aafdb7e489c3))
* reload ci new structure ([#297](https://github.com/verana-labs/vs-agent/issues/297)) ([38bad47](https://github.com/verana-labs/vs-agent/commit/38bad47f20ec541bc627cdc687c883e2eab48459))
* remove duplicate context at did creation ([#261](https://github.com/verana-labs/vs-agent/issues/261)) ([f266626](https://github.com/verana-labs/vs-agent/commit/f266626d3029be4a3bd0886d2f46404002af970a))
* remove matrix in cd ([dcb6b94](https://github.com/verana-labs/vs-agent/commit/dcb6b9401f6ff0200e3cd1a8e008bbc7debc80b3))
* repeated DID Document updates and migrate legacy verification methods ([#269](https://github.com/verana-labs/vs-agent/issues/269)) ([f667aeb](https://github.com/verana-labs/vs-agent/commit/f667aebde6902cbb0815c21fd7e85959c2ce0bd0))
* set defaults to 2060 OU data ([#313](https://github.com/verana-labs/vs-agent/issues/313)) ([1d1bfeb](https://github.com/verana-labs/vs-agent/commit/1d1bfeb55518febcfbdcd6d3e4940586e42dc4b7))
* short url processing for credential offer invitations ([#308](https://github.com/verana-labs/vs-agent/issues/308)) ([7347e1f](https://github.com/verana-labs/vs-agent/commit/7347e1f7003e78dc40ba3e0080a9cc5f0121b844))
* simplify and strengthen credential and JSON Schema credential management ([#264](https://github.com/verana-labs/vs-agent/issues/264)) ([f6cc927](https://github.com/verana-labs/vs-agent/commit/f6cc9271f9b04324cb9e887630c4b7b231d098e7))
* swager enablement is through a configuration flag ([#280](https://github.com/verana-labs/vs-agent/issues/280)) ([6d94761](https://github.com/verana-labs/vs-agent/commit/6d94761be38f9f42c6a28c05b3a1a6f55bd5475b))
* update based on Docker extension rules ([#298](https://github.com/verana-labs/vs-agent/issues/298)) ([23e644c](https://github.com/verana-labs/vs-agent/commit/23e644c138210afbf16a59ce790bf7f0681f0949))
* update didwebvh ts dependency to lastest version ([#272](https://github.com/verana-labs/vs-agent/issues/272)) ([deaa141](https://github.com/verana-labs/vs-agent/commit/deaa141740349677465bd905aafa530ff540ed65))
* update packages for trusted published ([81a4b67](https://github.com/verana-labs/vs-agent/commit/81a4b67a39060e0a47ccaf24efbc6406d6c33593))
* update structure on credentials ([#268](https://github.com/verana-labs/vs-agent/issues/268)) ([006cb0d](https://github.com/verana-labs/vs-agent/commit/006cb0d640f6dbb8d92dd43b5cbc27f6163acd16))
* Update Whois rules only when it is a service ([#295](https://github.com/verana-labs/vs-agent/issues/295)) ([a76bc48](https://github.com/verana-labs/vs-agent/commit/a76bc48a1a08369edfa914227b206ba3d4151e77))
* use helm chat logic ([#300](https://github.com/verana-labs/vs-agent/issues/300)) ([31fca49](https://github.com/verana-labs/vs-agent/commit/31fca49ea1eb243288fc910bedab5ae392b9cf20))
* use organization repo for helm action ([#299](https://github.com/verana-labs/vs-agent/issues/299)) ([f249ad1](https://github.com/verana-labs/vs-agent/commit/f249ad13887c3e37d6d232125dc1744f65fc46a5))
* use Query Parameter for resourceType ([#276](https://github.com/verana-labs/vs-agent/issues/276)) ([a6f8921](https://github.com/verana-labs/vs-agent/commit/a6f8921a8cd6e078a7bf8f5b4dc0a16dfe32c769))
* use relatedjsoncredential in place exchangeid ([#315](https://github.com/verana-labs/vs-agent/issues/315)) ([f52df39](https://github.com/verana-labs/vs-agent/commit/f52df3902352f0c21ec145374bd1d7817be556cf))
* use vpr:verana:vna-testnet in place api ([#262](https://github.com/verana-labs/vs-agent/issues/262)) ([7314b2a](https://github.com/verana-labs/vs-agent/commit/7314b2a5c850ad74819f9baefa9482ce3c53fd83))
* **VTC:** refactor update object with post method ([#283](https://github.com/verana-labs/vs-agent/issues/283)) ([6639429](https://github.com/verana-labs/vs-agent/commit/663942980d437099b4462c7853165c71bd442d26))

## [1.5.3](https://github.com/verana-labs/vs-agent/compare/v1.5.2...v1.5.3) (2025-10-08)


### Bug Fixes

* selft tr creation multikey support ([#248](https://github.com/verana-labs/vs-agent/issues/248)) ([2af6e0f](https://github.com/verana-labs/vs-agent/commit/2af6e0fdf775f2941fa282f7704cbbbb667771bc))

## [1.5.2](https://github.com/verana-labs/vs-agent/compare/v1.5.1...v1.5.2) (2025-10-06)


### Bug Fixes

* migrate DID verification methods to Multikey format ([#245](https://github.com/verana-labs/vs-agent/issues/245)) ([ac6710b](https://github.com/verana-labs/vs-agent/commit/ac6710be32f79a980c9d9477ddbedef4ba5cffe1))

## [1.5.1](https://github.com/verana-labs/vs-agent/compare/v1.5.0...v1.5.1) (2025-10-06)


### Bug Fixes

* remove PUBLIC_API_BASE_URL constant on invitation url ([#243](https://github.com/verana-labs/vs-agent/issues/243)) ([498b752](https://github.com/verana-labs/vs-agent/commit/498b752372e8abaa5736ae3fe37434be9ecc8c87))

## [1.5.0](https://github.com/verana-labs/vs-agent/compare/v1.4.0...v1.5.0) (2025-09-30)


### Features

* make storage‐update and backup configurable ([#231](https://github.com/verana-labs/vs-agent/issues/231)) ([5350103](https://github.com/verana-labs/vs-agent/commit/535010326ca0ab1fa07a693b8886e89bd608ab7a))
* support did:webvh object registration ([#227](https://github.com/verana-labs/vs-agent/issues/227)) ([ebf5f14](https://github.com/verana-labs/vs-agent/commit/ebf5f140ffda537a4cc6b2cedd7ca4425546ef4e))


### Bug Fixes

* admin port for secure endpoint ([#242](https://github.com/verana-labs/vs-agent/issues/242)) ([42c6b56](https://github.com/verana-labs/vs-agent/commit/42c6b56735e83f8c8257be6bc75993120990f3e5))
* webvh log content type ([#238](https://github.com/verana-labs/vs-agent/issues/238)) ([f330d35](https://github.com/verana-labs/vs-agent/commit/f330d3569268de16eca6480293f35eab2819fae2))

## [1.4.0](https://github.com/verana-labs/vs-agent/compare/v1.3.2...v1.4.0) (2025-09-19)


### Features

* add configurable parameters support for linked vp ([#191](https://github.com/verana-labs/vs-agent/issues/191)) ([bee8812](https://github.com/verana-labs/vs-agent/commit/bee8812a2f1e26c0d4ba9c7a460089b2d67d9516))
* add deployment requests & limits + docs ([#226](https://github.com/verana-labs/vs-agent/issues/226)) ([cc2fe52](https://github.com/verana-labs/vs-agent/commit/cc2fe524f99ba15efd39255168dd491f5241e31e))
* add health check endpoint and integrate with kubernetes for email alerts ([#198](https://github.com/verana-labs/vs-agent/issues/198)) ([1428234](https://github.com/verana-labs/vs-agent/commit/14282342f7428ac579b88e35cb04704624b34899))
* add test endpoints for verifiable credentials and presentations ([#140](https://github.com/verana-labs/vs-agent/issues/140)) ([34377b1](https://github.com/verana-labs/vs-agent/commit/34377b1725200964c5c7cd6a879abd1ce59b513c))
* add verification field to EMrtdDataSubmitMessage ([#220](https://github.com/verana-labs/vs-agent/issues/220)) ([4ab889b](https://github.com/verana-labs/vs-agent/commit/4ab889bd498e9dec938d089f129adfa5cc6995b8))
* allow legacy did:web when using did:webvh ([#222](https://github.com/verana-labs/vs-agent/issues/222)) ([bb5a3d9](https://github.com/verana-labs/vs-agent/commit/bb5a3d92692ddac2a771c16db948cdea3d545911))
* default redirect in invitation endpoint to true ([#158](https://github.com/verana-labs/vs-agent/issues/158)) ([ec208e7](https://github.com/verana-labs/vs-agent/commit/ec208e7405054c19e96e742b69ff5772677e1bda))
* did:webvh creation support ([#206](https://github.com/verana-labs/vs-agent/issues/206)) ([fc2a87d](https://github.com/verana-labs/vs-agent/commit/fc2a87d1a6f3f448566173ceb31e69ad960f0f4d))
* enable eMRTD authenticity and integrity vs-agent ([#207](https://github.com/verana-labs/vs-agent/issues/207)) ([6a52d52](https://github.com/verana-labs/vs-agent/commit/6a52d5218dc08c57620bc9fa67abc152c0c60dcf))
* make public api server a nestjs app ([#169](https://github.com/verana-labs/vs-agent/issues/169)) ([16ca1ae](https://github.com/verana-labs/vs-agent/commit/16ca1aef5fa63b01f496a157cb37653649be601d))
* remove redundant environment variables ([#162](https://github.com/verana-labs/vs-agent/issues/162)) ([a9b13e5](https://github.com/verana-labs/vs-agent/commit/a9b13e52a4179374d08794042087df5cc657ac40))
* set public API and endpoints from public DID ([#175](https://github.com/verana-labs/vs-agent/issues/175)) ([3e67f75](https://github.com/verana-labs/vs-agent/commit/3e67f75faee4dc3b28be413658793b309dd5a783))
* support DIDComm and self-signed Verifiable Trust on did:webvh ([#212](https://github.com/verana-labs/vs-agent/issues/212)) ([941f566](https://github.com/verana-labs/vs-agent/commit/941f5660fd31d497534434bc577b865ce8dfc382))
* Update credo-ts-didcomm-mrtd version 0.0.15 ([#211](https://github.com/verana-labs/vs-agent/issues/211)) ([4c37015](https://github.com/verana-labs/vs-agent/commit/4c37015218d323f67e80415074ad67a316c2e0b3))
* Update credo-ts-didcomm-mrtd version 0.0.16 ([#216](https://github.com/verana-labs/vs-agent/issues/216)) ([713ce97](https://github.com/verana-labs/vs-agent/commit/713ce97f58e3fc6cff67a753624106427eda3a0b))
* Update model packages ([#219](https://github.com/verana-labs/vs-agent/issues/219)) ([13d2985](https://github.com/verana-labs/vs-agent/commit/13d298577f94be3d1cca54ddc74551bf94b09d1e))


### Bug Fixes

* add data.json to dockerfile ([#142](https://github.com/verana-labs/vs-agent/issues/142)) ([4f2b125](https://github.com/verana-labs/vs-agent/commit/4f2b125b090f8798762b43b36653d48e349ba8ff))
* add patch files to docker agent ([#214](https://github.com/verana-labs/vs-agent/issues/214)) ([909b04c](https://github.com/verana-labs/vs-agent/commit/909b04cd1f8b9694be79027ac746e1d4d0fd0b64))
* add patch to docker files ([#215](https://github.com/verana-labs/vs-agent/issues/215)) ([f063dd4](https://github.com/verana-labs/vs-agent/commit/f063dd4e4c70089226f1cb4991824375b2d80aac))
* add public did method selector to Helm chart ([#223](https://github.com/verana-labs/vs-agent/issues/223)) ([8d2b032](https://github.com/verana-labs/vs-agent/commit/8d2b032731780a66e1e769d29ecffe566892e02a))
* add release please ([#173](https://github.com/verana-labs/vs-agent/issues/173)) ([62abf46](https://github.com/verana-labs/vs-agent/commit/62abf4650b2760902d539d422aab37a2aceb751c))
* add root release please ([#185](https://github.com/verana-labs/vs-agent/issues/185)) ([bbbb0a6](https://github.com/verana-labs/vs-agent/commit/bbbb0a670659ff73e92dd79b0563fb7f2b8ebd09))
* add updateAllPackages ([#180](https://github.com/verana-labs/vs-agent/issues/180)) ([03e9a40](https://github.com/verana-labs/vs-agent/commit/03e9a4050b5b7b54834f4bdc378eee83fcc1ffc6))
* alsoKnownAs in legacy did:web ([#225](https://github.com/verana-labs/vs-agent/issues/225)) ([ddcc8ec](https://github.com/verana-labs/vs-agent/commit/ddcc8ec4df90aa6498065a1eb688dce9ba88eb59))
* anoncreds objects issuer id for legacy did:web ([#224](https://github.com/verana-labs/vs-agent/issues/224)) ([8a387da](https://github.com/verana-labs/vs-agent/commit/8a387da7410d569bd0387b4f0088226f1aaf030d))
* AnonCreds service not added to DID Document ([#168](https://github.com/verana-labs/vs-agent/issues/168)) ([94f0885](https://github.com/verana-labs/vs-agent/commit/94f088524c6e5b435b241031bacc60bbb98422d1))
* avoid regenerating self-signed cert on every request ([#202](https://github.com/verana-labs/vs-agent/issues/202)) ([f458574](https://github.com/verana-labs/vs-agent/commit/f4585742df52fa301c5cdbb08218a5cdb3afb3bc))
* change components name ([#183](https://github.com/verana-labs/vs-agent/issues/183)) ([8a23fc3](https://github.com/verana-labs/vs-agent/commit/8a23fc33513b8f63cf2e0f844055fe0fe260521c))
* correct structure of self-signed DID document ([#196](https://github.com/verana-labs/vs-agent/issues/196)) ([4df0d5c](https://github.com/verana-labs/vs-agent/commit/4df0d5ca842f23c79bcc4252ab13d94a598fcdb9))
* data.json copy in vs-agent Dockerfile ([#161](https://github.com/verana-labs/vs-agent/issues/161)) ([58eab26](https://github.com/verana-labs/vs-agent/commit/58eab26a19522829f47c2aa71fe8d8822dc4356d))
* don't recreate DIDComm keys at every startup ([#188](https://github.com/verana-labs/vs-agent/issues/188)) ([c5f8602](https://github.com/verana-labs/vs-agent/commit/c5f8602da21fd10cfa096427fcdb887d4b2072c0))
* improvement record validation ([#210](https://github.com/verana-labs/vs-agent/issues/210)) ([074ac00](https://github.com/verana-labs/vs-agent/commit/074ac00035ccbf6d22db8ecbbf548dab7410ade0))
* increase request limit to 5MB on nestjs demo ([#190](https://github.com/verana-labs/vs-agent/issues/190)) ([113c4a3](https://github.com/verana-labs/vs-agent/commit/113c4a31bcea42acff066692c443b0a00e061cc0))
* invitation to public services using pthid ([#92](https://github.com/verana-labs/vs-agent/issues/92)) ([1ab0c64](https://github.com/verana-labs/vs-agent/commit/1ab0c64b85cc10f615eacd0b4105a3fefd9ac9e9))
* local schemas digest sri ([#205](https://github.com/verana-labs/vs-agent/issues/205)) ([accc11f](https://github.com/verana-labs/vs-agent/commit/accc11f9252ad6459c26ad7d6682536cfe69aa9a))
* provide local default schema ([#204](https://github.com/verana-labs/vs-agent/issues/204)) ([86509b6](https://github.com/verana-labs/vs-agent/commit/86509b6349f75ac30e6a733d9a8e0820780be9fe))
* release please ([#178](https://github.com/verana-labs/vs-agent/issues/178)) ([b143702](https://github.com/verana-labs/vs-agent/commit/b1437022d828d684c8655762152692ab86cc046a))
* release please config ([#177](https://github.com/verana-labs/vs-agent/issues/177)) ([54753ac](https://github.com/verana-labs/vs-agent/commit/54753acac82b5ecbec23333b1844aa3e95ec6eb6))
* remove node-workspace ([#181](https://github.com/verana-labs/vs-agent/issues/181)) ([59c0b33](https://github.com/verana-labs/vs-agent/commit/59c0b3383d2e07b151480d0f8cb772a070e58e3b))
* Remove PUT method from exposed port configuration ([#187](https://github.com/verana-labs/vs-agent/issues/187)) ([f312009](https://github.com/verana-labs/vs-agent/commit/f312009c120cecb14fae0a30de7d091ecefdb5f9))
* remove unused anoncreds URL ([#174](https://github.com/verana-labs/vs-agent/issues/174)) ([efd4bbf](https://github.com/verana-labs/vs-agent/commit/efd4bbf4410052394e5961c22f812f830f26ecc5))
* return legacy did:web document when resolving legacy did ([#228](https://github.com/verana-labs/vs-agent/issues/228)) ([d194f28](https://github.com/verana-labs/vs-agent/commit/d194f28b59057eb30e4a76131567bd4f3837f60b))
* some adjustments for self-signed VTR ([#217](https://github.com/verana-labs/vs-agent/issues/217)) ([fe43cbe](https://github.com/verana-labs/vs-agent/commit/fe43cbe6a43dadaddf603d3a6d10ec9bad74a97f))
* support tpl on eventsBaseUrl ([#171](https://github.com/verana-labs/vs-agent/issues/171)) ([3cf0021](https://github.com/verana-labs/vs-agent/commit/3cf00213fc0e0696f7036861b949134b921f2561))
* update permission response ([#208](https://github.com/verana-labs/vs-agent/issues/208)) ([8e32311](https://github.com/verana-labs/vs-agent/commit/8e32311555eb1cc186759432c338311df547a6b6))
* update retrieve json schema ([#197](https://github.com/verana-labs/vs-agent/issues/197)) ([aafd763](https://github.com/verana-labs/vs-agent/commit/aafd763895449625e759b329350113b89044ab9a))
* update-release-please ([#179](https://github.com/verana-labs/vs-agent/issues/179)) ([7caa09c](https://github.com/verana-labs/vs-agent/commit/7caa09c0e9e1d5b642fdbb087e663f487b7e994b))
* vs-agent version ([#165](https://github.com/verana-labs/vs-agent/issues/165)) ([94fb01d](https://github.com/verana-labs/vs-agent/commit/94fb01d2a31a7394a98c5472eb28450dc7da8bfa))


### Reverts

* last stable version ([6560d8b](https://github.com/verana-labs/vs-agent/commit/6560d8b743525fb041aee1719b0c11a1bdde46c0))

## [1.4.0](https://github.com/verana-labs/vs-agent/compare/v1.3.2...v1.4.0) (2025-09-16)


### Features

* add configurable parameters support for linked vp ([#191](https://github.com/verana-labs/vs-agent/issues/191)) ([bee8812](https://github.com/verana-labs/vs-agent/commit/bee8812a2f1e26c0d4ba9c7a460089b2d67d9516))
* add deployment requests & limits + docs ([#226](https://github.com/verana-labs/vs-agent/issues/226)) ([cc2fe52](https://github.com/verana-labs/vs-agent/commit/cc2fe524f99ba15efd39255168dd491f5241e31e))
* add health check endpoint and integrate with kubernetes for email alerts ([#198](https://github.com/verana-labs/vs-agent/issues/198)) ([1428234](https://github.com/verana-labs/vs-agent/commit/14282342f7428ac579b88e35cb04704624b34899))
* add test endpoints for verifiable credentials and presentations ([#140](https://github.com/verana-labs/vs-agent/issues/140)) ([34377b1](https://github.com/verana-labs/vs-agent/commit/34377b1725200964c5c7cd6a879abd1ce59b513c))
* add verification field to EMrtdDataSubmitMessage ([#220](https://github.com/verana-labs/vs-agent/issues/220)) ([4ab889b](https://github.com/verana-labs/vs-agent/commit/4ab889bd498e9dec938d089f129adfa5cc6995b8))
* allow legacy did:web when using did:webvh ([#222](https://github.com/verana-labs/vs-agent/issues/222)) ([bb5a3d9](https://github.com/verana-labs/vs-agent/commit/bb5a3d92692ddac2a771c16db948cdea3d545911))
* default redirect in invitation endpoint to true ([#158](https://github.com/verana-labs/vs-agent/issues/158)) ([ec208e7](https://github.com/verana-labs/vs-agent/commit/ec208e7405054c19e96e742b69ff5772677e1bda))
* did:webvh creation support ([#206](https://github.com/verana-labs/vs-agent/issues/206)) ([fc2a87d](https://github.com/verana-labs/vs-agent/commit/fc2a87d1a6f3f448566173ceb31e69ad960f0f4d))
* enable eMRTD authenticity and integrity vs-agent ([#207](https://github.com/verana-labs/vs-agent/issues/207)) ([6a52d52](https://github.com/verana-labs/vs-agent/commit/6a52d5218dc08c57620bc9fa67abc152c0c60dcf))
* make public api server a nestjs app ([#169](https://github.com/verana-labs/vs-agent/issues/169)) ([16ca1ae](https://github.com/verana-labs/vs-agent/commit/16ca1aef5fa63b01f496a157cb37653649be601d))
* remove redundant environment variables ([#162](https://github.com/verana-labs/vs-agent/issues/162)) ([a9b13e5](https://github.com/verana-labs/vs-agent/commit/a9b13e52a4179374d08794042087df5cc657ac40))
* set public API and endpoints from public DID ([#175](https://github.com/verana-labs/vs-agent/issues/175)) ([3e67f75](https://github.com/verana-labs/vs-agent/commit/3e67f75faee4dc3b28be413658793b309dd5a783))
* support DIDComm and self-signed Verifiable Trust on did:webvh ([#212](https://github.com/verana-labs/vs-agent/issues/212)) ([941f566](https://github.com/verana-labs/vs-agent/commit/941f5660fd31d497534434bc577b865ce8dfc382))
* Update credo-ts-didcomm-mrtd version 0.0.15 ([#211](https://github.com/verana-labs/vs-agent/issues/211)) ([4c37015](https://github.com/verana-labs/vs-agent/commit/4c37015218d323f67e80415074ad67a316c2e0b3))
* Update credo-ts-didcomm-mrtd version 0.0.16 ([#216](https://github.com/verana-labs/vs-agent/issues/216)) ([713ce97](https://github.com/verana-labs/vs-agent/commit/713ce97f58e3fc6cff67a753624106427eda3a0b))
* Update model packages ([#219](https://github.com/verana-labs/vs-agent/issues/219)) ([13d2985](https://github.com/verana-labs/vs-agent/commit/13d298577f94be3d1cca54ddc74551bf94b09d1e))


### Bug Fixes

* add data.json to dockerfile ([#142](https://github.com/verana-labs/vs-agent/issues/142)) ([4f2b125](https://github.com/verana-labs/vs-agent/commit/4f2b125b090f8798762b43b36653d48e349ba8ff))
* add patch files to docker agent ([#214](https://github.com/verana-labs/vs-agent/issues/214)) ([909b04c](https://github.com/verana-labs/vs-agent/commit/909b04cd1f8b9694be79027ac746e1d4d0fd0b64))
* add patch to docker files ([#215](https://github.com/verana-labs/vs-agent/issues/215)) ([f063dd4](https://github.com/verana-labs/vs-agent/commit/f063dd4e4c70089226f1cb4991824375b2d80aac))
* add public did method selector to Helm chart ([#223](https://github.com/verana-labs/vs-agent/issues/223)) ([8d2b032](https://github.com/verana-labs/vs-agent/commit/8d2b032731780a66e1e769d29ecffe566892e02a))
* add release please ([#173](https://github.com/verana-labs/vs-agent/issues/173)) ([62abf46](https://github.com/verana-labs/vs-agent/commit/62abf4650b2760902d539d422aab37a2aceb751c))
* add root release please ([#185](https://github.com/verana-labs/vs-agent/issues/185)) ([bbbb0a6](https://github.com/verana-labs/vs-agent/commit/bbbb0a670659ff73e92dd79b0563fb7f2b8ebd09))
* add updateAllPackages ([#180](https://github.com/verana-labs/vs-agent/issues/180)) ([03e9a40](https://github.com/verana-labs/vs-agent/commit/03e9a4050b5b7b54834f4bdc378eee83fcc1ffc6))
* alsoKnownAs in legacy did:web ([#225](https://github.com/verana-labs/vs-agent/issues/225)) ([ddcc8ec](https://github.com/verana-labs/vs-agent/commit/ddcc8ec4df90aa6498065a1eb688dce9ba88eb59))
* anoncreds objects issuer id for legacy did:web ([#224](https://github.com/verana-labs/vs-agent/issues/224)) ([8a387da](https://github.com/verana-labs/vs-agent/commit/8a387da7410d569bd0387b4f0088226f1aaf030d))
* AnonCreds service not added to DID Document ([#168](https://github.com/verana-labs/vs-agent/issues/168)) ([94f0885](https://github.com/verana-labs/vs-agent/commit/94f088524c6e5b435b241031bacc60bbb98422d1))
* avoid regenerating self-signed cert on every request ([#202](https://github.com/verana-labs/vs-agent/issues/202)) ([f458574](https://github.com/verana-labs/vs-agent/commit/f4585742df52fa301c5cdbb08218a5cdb3afb3bc))
* change components name ([#183](https://github.com/verana-labs/vs-agent/issues/183)) ([8a23fc3](https://github.com/verana-labs/vs-agent/commit/8a23fc33513b8f63cf2e0f844055fe0fe260521c))
* correct structure of self-signed DID document ([#196](https://github.com/verana-labs/vs-agent/issues/196)) ([4df0d5c](https://github.com/verana-labs/vs-agent/commit/4df0d5ca842f23c79bcc4252ab13d94a598fcdb9))
* data.json copy in vs-agent Dockerfile ([#161](https://github.com/verana-labs/vs-agent/issues/161)) ([58eab26](https://github.com/verana-labs/vs-agent/commit/58eab26a19522829f47c2aa71fe8d8822dc4356d))
* don't recreate DIDComm keys at every startup ([#188](https://github.com/verana-labs/vs-agent/issues/188)) ([c5f8602](https://github.com/verana-labs/vs-agent/commit/c5f8602da21fd10cfa096427fcdb887d4b2072c0))
* improvement record validation ([#210](https://github.com/verana-labs/vs-agent/issues/210)) ([074ac00](https://github.com/verana-labs/vs-agent/commit/074ac00035ccbf6d22db8ecbbf548dab7410ade0))
* increase request limit to 5MB on nestjs demo ([#190](https://github.com/verana-labs/vs-agent/issues/190)) ([113c4a3](https://github.com/verana-labs/vs-agent/commit/113c4a31bcea42acff066692c443b0a00e061cc0))
* invitation to public services using pthid ([#92](https://github.com/verana-labs/vs-agent/issues/92)) ([1ab0c64](https://github.com/verana-labs/vs-agent/commit/1ab0c64b85cc10f615eacd0b4105a3fefd9ac9e9))
* local schemas digest sri ([#205](https://github.com/verana-labs/vs-agent/issues/205)) ([accc11f](https://github.com/verana-labs/vs-agent/commit/accc11f9252ad6459c26ad7d6682536cfe69aa9a))
* provide local default schema ([#204](https://github.com/verana-labs/vs-agent/issues/204)) ([86509b6](https://github.com/verana-labs/vs-agent/commit/86509b6349f75ac30e6a733d9a8e0820780be9fe))
* release please ([#178](https://github.com/verana-labs/vs-agent/issues/178)) ([b143702](https://github.com/verana-labs/vs-agent/commit/b1437022d828d684c8655762152692ab86cc046a))
* release please config ([#177](https://github.com/verana-labs/vs-agent/issues/177)) ([54753ac](https://github.com/verana-labs/vs-agent/commit/54753acac82b5ecbec23333b1844aa3e95ec6eb6))
* remove node-workspace ([#181](https://github.com/verana-labs/vs-agent/issues/181)) ([59c0b33](https://github.com/verana-labs/vs-agent/commit/59c0b3383d2e07b151480d0f8cb772a070e58e3b))
* Remove PUT method from exposed port configuration ([#187](https://github.com/verana-labs/vs-agent/issues/187)) ([f312009](https://github.com/verana-labs/vs-agent/commit/f312009c120cecb14fae0a30de7d091ecefdb5f9))
* remove unused anoncreds URL ([#174](https://github.com/verana-labs/vs-agent/issues/174)) ([efd4bbf](https://github.com/verana-labs/vs-agent/commit/efd4bbf4410052394e5961c22f812f830f26ecc5))
* return legacy did:web document when resolving legacy did ([#228](https://github.com/verana-labs/vs-agent/issues/228)) ([d194f28](https://github.com/verana-labs/vs-agent/commit/d194f28b59057eb30e4a76131567bd4f3837f60b))
* some adjustments for self-signed VTR ([#217](https://github.com/verana-labs/vs-agent/issues/217)) ([fe43cbe](https://github.com/verana-labs/vs-agent/commit/fe43cbe6a43dadaddf603d3a6d10ec9bad74a97f))
* support tpl on eventsBaseUrl ([#171](https://github.com/verana-labs/vs-agent/issues/171)) ([3cf0021](https://github.com/verana-labs/vs-agent/commit/3cf00213fc0e0696f7036861b949134b921f2561))
* update permission response ([#208](https://github.com/verana-labs/vs-agent/issues/208)) ([8e32311](https://github.com/verana-labs/vs-agent/commit/8e32311555eb1cc186759432c338311df547a6b6))
* update retrieve json schema ([#197](https://github.com/verana-labs/vs-agent/issues/197)) ([aafd763](https://github.com/verana-labs/vs-agent/commit/aafd763895449625e759b329350113b89044ab9a))
* update-release-please ([#179](https://github.com/verana-labs/vs-agent/issues/179)) ([7caa09c](https://github.com/verana-labs/vs-agent/commit/7caa09c0e9e1d5b642fdbb087e663f487b7e994b))
* vs-agent version ([#165](https://github.com/verana-labs/vs-agent/issues/165)) ([94fb01d](https://github.com/verana-labs/vs-agent/commit/94fb01d2a31a7394a98c5472eb28450dc7da8bfa))
