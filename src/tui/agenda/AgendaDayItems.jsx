// src/tui/agenda/AgendaDayItems.jsx
import { busyGroups, isBusy } from "../../utils/agendaBusy";
import { isAppointment, isSpecial } from "../../utils/agendaSpecial";
import AgendaBusyRow from "./AgendaBusyRow";
import AgendaItem from "./AgendaItem";
import AgendaSpecialRow from "./AgendaSpecialRow";

// A day's items (already in display order): special days and busy time as tight
// one-line rows on top, appointments below. Periods are zones around the day.
export default function AgendaDayItems({ items, day, today, itemProps }) {
    const specials = items.filter(isSpecial);
    const busy = items.filter(isBusy);
    const appointments = items.filter(isAppointment);
    if (!specials.length && !busy.length && !appointments.length) {
        return <p className="text-neutral-600 uppercase">niks gepland</p>;
    }

    return (
        <>
            {(specials.length > 0 || busy.length > 0) && (
                <div>
                    {specials.map((occ) => (
                        <AgendaSpecialRow key={occ.id} occurrence={occ} isToday={day === today} onOpen={itemProps.onOpen} />
                    ))}
                    {busyGroups(busy, day).map((group) => (
                        <AgendaBusyRow key={group.key} group={group} people={itemProps.people} onOpen={(g) => itemProps.onOpenBusy(g, day)} />
                    ))}
                </div>
            )}
            {appointments.map((event) => (
                <AgendaItem key={event.id} event={event} day={day} {...itemProps} />
            ))}
        </>
    );
}
