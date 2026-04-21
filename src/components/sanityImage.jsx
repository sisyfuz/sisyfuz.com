// src/components/sanityImage.jsx
import imageUrlBuilder from '@sanity/image-url';

// Because this file is in 'components', it needs to go up one level (../) 
// and then into 'utils' to find the client.
import { client } from '../sanityClient';

const builder = imageUrlBuilder(client);

export function urlFor(source) {
    return builder.image(source);
}