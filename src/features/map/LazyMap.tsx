import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui';

// Leaflet (~40 KB gz + CSS) is only downloaded when a map is actually shown.
const RouteMapImpl = lazy(() => import('./RouteMap'));
const PinPickerImpl = lazy(() => import('./RouteMap').then((m) => ({ default: m.PinPicker })));

export function RouteMap(props: ComponentProps<typeof RouteMapImpl>) {
  return (
    <Suspense fallback={<Skeleton height={props.height ?? 320} />}>
      <RouteMapImpl {...props} />
    </Suspense>
  );
}

export function PinPicker(props: ComponentProps<typeof PinPickerImpl>) {
  return (
    <Suspense fallback={<Skeleton height={props.height ?? 240} />}>
      <PinPickerImpl {...props} />
    </Suspense>
  );
}

export function MapCredit() {
  return <p className="xsmall muted">Map © OpenStreetMap contributors. Opening a map loads tiles from openstreetmap.org. Distances are straight-line estimates.</p>;
}
