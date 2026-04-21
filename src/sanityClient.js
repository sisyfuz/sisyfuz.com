
// src/utils/sanityClient.js
import { createClient } from '@sanity/client';

export const client = createClient({
    // You can find these details in your sanity/sanity.config.js 
    // or on your dashboard at manage.sanity.io
    projectId: 'gt7prmxg',
    dataset: 'production',

    // useCdn: true gives you fast, cached responses (perfect for images/portfolio data)
    // useCdn: false bypasses the cache (good if you need real-time updates)
    useCdn: true,

    // Use today's date (YYYY-MM-DD) to lock in the API behavior
    apiVersion: '2026-04-17',
});