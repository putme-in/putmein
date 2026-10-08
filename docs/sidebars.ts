import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'index',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'CLI Usage & Commands',
      link: {
        type: 'doc',
        id: 'usage/index',
      },
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'usage/commands',
          label: 'Command Reference',
        },
        {
          type: 'doc',
          id: 'usage/lifecycle',
          label: 'Service Lifecycle',
        },
      ],
    },
    {
      type: 'category',
      label: 'Settings & Configuration',
      link: {
        type: 'doc',
        id: 'settings/index',
      },
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'settings/environment-variables',
          label: 'Environment Variables',
        },
        {
          type: 'doc',
          id: 'settings/config-file',
          label: 'Configuration Files',
        },
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      link: {
        type: 'doc',
        id: 'developer/index',
      },
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'developer/prerequisites',
          label: 'Prerequisites',
        },
        {
          type: 'doc',
          id: 'developer/setup',
          label: 'Setting up the Project',
        },
        { type: 'doc', id: 'developer/project-setup', label: 'Project Setup' },
        { type: 'doc', id: 'developer/chat-deployment', label: 'Chat Deployment Setup' },
        { type: 'doc', id: 'developer/deployment-lifecycle', label: 'Concurrency, Rollback & Cleanup' },
        { type: 'doc', id: 'developer/deployment-services', label: 'Templates, Health Checks & HTTPS' },
        { type: 'doc', id: 'developer/git-sources', label: 'Git Sources & Private Repositories' },
        { type: 'doc', id: 'developer/application-frameworks', label: 'Application Detection & Deployment' },
        { type: 'doc', id: 'developer/security-rules', label: 'Security Rules & Scanning' },
        { type: 'doc', id: 'developer/advanced-security', label: 'Advanced Security Scanning' },
        { type: 'doc', id: 'developer/legacy-artifacts', label: 'Legacy Artifact Review' },
        { type: 'doc', id: 'developer/monitoring-rules', label: 'Monitoring Rules' },
        { type: 'doc', id: 'developer/incidents', label: 'Unified Incidents' },
      ],
    },
    {
      type: 'doc',
      id: 'troubleshooting',
      label: 'Troubleshooting',
    },
  ],
};

export default sidebars;
