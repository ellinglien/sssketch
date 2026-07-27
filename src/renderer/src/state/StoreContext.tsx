import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import { initialState, reducer, type Action, type AppState } from './store'

const StateCtx = createContext<AppState>(initialState)
const DispatchCtx = createContext<Dispatch<Action>>(() => {})

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useAppState(): AppState {
  return useContext(StateCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchCtx)
}
