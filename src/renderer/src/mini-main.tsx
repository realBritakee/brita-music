import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Mini } from './Mini'
import './styles/theme.css'
import './styles/mini.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Mini />
  </StrictMode>,
)
