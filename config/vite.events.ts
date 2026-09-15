import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({root:root+'apps/platform',publicDir:root+'packages/ui/assets',plugins:[react()],build:{outDir:root+'dist/events',emptyOutDir:true}});
