declare module 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/ApiClient.js' {
  import type platformClient from 'purecloud-platform-client-v2';

  const ApiClient: new () => typeof platformClient.ApiClient;
  export default ApiClient;
}

declare module 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/ArchitectApi.js' {
  import type platformClient from 'purecloud-platform-client-v2';

  const ArchitectApi: typeof platformClient.ArchitectApi;
  export default ArchitectApi;
}

declare module 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/OrganizationApi.js' {
  import type platformClient from 'purecloud-platform-client-v2';

  const OrganizationApi: typeof platformClient.OrganizationApi;
  export default OrganizationApi;
}

declare module 'purecloud-platform-client-v2/src/purecloud-platform-client-v2/api/UsersApi.js' {
  import type platformClient from 'purecloud-platform-client-v2';

  const UsersApi: typeof platformClient.UsersApi;
  export default UsersApi;
}
