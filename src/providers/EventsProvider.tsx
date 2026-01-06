// Create a Context Provider for EventList

import { createContext, useContext, useReducer } from 'react';
import type { EventList } from '../types/event';


export const EventListContext = createContext(null);
export const EventListDispatchContext = createContext(null);

export function EventsProvider({ children }) {
  const [eventList, dispatch] = useReducer(
    eventListReducer,
    initialEvents
  );

  return (
    <EventListContext value={eventList}>
      <EventListDispatchContext value={dispatch}>
        {children}
      </EventListDispatchContext>
    </EventListContext>
  );
}

export function useEventList() {
  return useContext(EventListContext);
}

export function useEventListDispatch() {
  return useContext(EventListDispatchContext);
}

function eventListReducer(eventList : EventList, action) {
  switch (action.type) {
    case 'added': {
      return [...eventList, {
        id: action.id,
        name: action.name,
        isActive: action.isActive
      }];
    }
    case 'changed': {
      return eventList.map(t => {
        if (t.id === action.task.id) {
          return action.task;
        } else {
          return t;
        }
      });
    }
    case 'deleted': {
      return eventList.filter(t => t.id !== action.id);
    }
    default: {
      throw Error('Unknown action: ' + action.type);
    }
  }
}

export const initialEvents : EventList = [
  { id: "eabfb290-90b6-4ec2-bc0b-650f552012a2", name: 'AGI 2022', slug: "agi-2022", isActive: true, ageGroups: [
    {id: "ag-1", name: "Senior", gender: "men", eventId: "eabfb290-90b6-4ec2-bc0b-650f552012a2"},
    {id: "ag-2", name: "Senior", gender: "ladies", eventId: "eabfb290-90b6-4ec2-bc0b-650f552012a2"},
  ] },
  { id: "eabfb290-9aa6-4ec2-bd0b-650f64201201", name: 'AGI 2023', slug: "agi-2023", isActive: true, ageGroups: [] },
];
