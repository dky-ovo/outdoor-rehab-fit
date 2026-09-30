import { useEffect, useState } from 'react';
import { subscribeAccountData } from '../utils/accountSyncEvents';
import { getCurrentOwnerKey } from '../utils/userStorage';

export function useAccountDataRevision(kinds) {
  const [revision, setRevision] = useState(0), key = kinds.join(',');
  useEffect(() => subscribeAccountData(event => {
    if (event.remote && event.owner === getCurrentOwnerKey() && key.split(',').includes(event.kind)) setRevision(n => n + 1);
  }), [key]);
  return revision;
}
