import { Editor } from "./components/Editor"

export default function App() {
    // Full-bleed: the editor owns the whole viewport.
    return <Editor cornerRadius={0} />
}
