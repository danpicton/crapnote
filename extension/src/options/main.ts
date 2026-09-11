import { localStore, syncStore } from '../browser';
import { initOptions } from './controller';

void initOptions(document, syncStore(), localStore());
