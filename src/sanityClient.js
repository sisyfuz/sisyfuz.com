import { createClient } from '@sanity/client';

export const client = createClient({
    projectId: 'gt7prmxg',
    dataset: 'production',
    useCdn: true,
    apiVersion: '2024-04-15',
});