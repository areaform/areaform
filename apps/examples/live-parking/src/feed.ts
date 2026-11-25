// The sensor feed, simulated. A real car park sends the same events from its bay sensors, through
// the vendor's WebSocket, MQTT broker or webhook; replace `simulatedFeed` with something like:
//
//     const socket = new WebSocket('wss://sensors.example.com/car-park/42');
//     socket.onmessage = (message) => onEvent(JSON.parse(message.data) as SensorEvent);
//     return () => socket.close();
//
// Nothing else in the example changes: it only ever sees `SensorEvent`s.

/** One report from one bay sensor. */
export interface SensorEvent {
    sensorId: string;
    /** A car is over the sensor. */
    occupied: boolean;
    /** When the sensor saw it, milliseconds since 1970. */
    at: number;
}

export interface SimulatedFeedOptions {
    /** The same seed gives the same car park every time (default 7). */
    seed?: number;
    /** How often a car arrives or leaves, milliseconds (default 1500). */
    every?: number;
    /** The share of spots taken at the start (default 0.75). */
    taken?: number;
    /** Sensors that never report, as broken ones do. */
    silent?: readonly string[];
    /**
     * How often every working sensor reports again, changed or not, milliseconds (default 60000).
     * Real bay sensors send such a heartbeat; without one, a car parked for a long time would look
     * like a broken sensor.
     */
    heartbeat?: number;
}

/**
 * Reports every sensor once, as a feed does when it connects, then a car arriving or leaving every
 * `every` milliseconds, and every sensor again each `heartbeat`. Returns how to stop it.
 */
export function simulatedFeed(
    sensorIds: readonly string[],
    onEvent: (event: SensorEvent) => void,
    {
        seed = 7,
        every = 1500,
        taken = 0.75,
        silent = [],
        heartbeat = 60_000,
    }: SimulatedFeedOptions = {},
): () => void {
    const random = mulberry32(seed);
    const quiet = new Set(silent);
    const live = sensorIds.filter((id) => !quiet.has(id));
    const occupied = new Map(live.map((id) => [id, random() < taken]));
    const reportAll = () => {
        for (const [sensorId, isOccupied] of occupied)
            onEvent({ sensorId, occupied: isOccupied, at: Date.now() });
    };
    reportAll();
    const beat = setInterval(reportAll, heartbeat);

    const timer = setInterval(() => {
        const sensorId = live[Math.floor(random() * live.length)];
        if (!sensorId) return;
        const now = !occupied.get(sensorId);
        occupied.set(sensorId, now);
        onEvent({ sensorId, occupied: now, at: Date.now() });
    }, every);
    return () => {
        clearInterval(timer);
        clearInterval(beat);
    };
}

/** A small seeded random number generator, so the simulation can be repeated. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
