import flet as ft
import traceback

try:
    import pypdf
    import edge_tts
    import asyncio
    import base64
    import os
    import flet_audio as fta

    VOICES = {
        "🇦🇷 Elena (Mujer - Argentina)": "es-AR-ElenaNeural",
        "🇦🇷 Tomas (Hombre - Argentina)": "es-AR-TomasNeural",
        "🇲🇽 Dalia (Mujer - México)": "es-MX-DaliaNeural",
        "🇲🇽 Jorge (Hombre - México)": "es-MX-JorgeNeural",
        "🇨🇴 Salome (Mujer - Colombia)": "es-CO-SalomeNeural",
        "🇨🇴 Gonzalo (Hombre - Colombia)": "es-CO-GonzaloNeural",
        "🇺🇸 Alonso (Hombre - EEUU)": "es-US-AlonsoNeural",
        "🇺🇸 Paloma (Mujer - EEUU)": "es-US-PalomaNeural",
        "🇪🇸 Alvaro (Hombre - España)": "es-ES-AlvaroNeural",
    }

    def main(page: ft.Page):
        page.title = "Lector de PDF con Voz"
        page.vertical_alignment = ft.MainAxisAlignment.START
        page.horizontal_alignment = ft.CrossAxisAlignment.CENTER
        page.padding = 20
        page.theme_mode = ft.ThemeMode.SYSTEM
        page.window_width = 400
        page.window_height = 700

        # Estado de la aplicacion
        pdf_text_chunks = []
        current_chunk_idx = 0
        is_playing = False
        is_paused = False

        def on_audio_state_changed(e):
            nonlocal is_playing, is_paused
            print(f"Audio state: {e.data}")
            if e.data == "completed":
                if not is_paused and is_playing:
                    skip_next(None)

        audio = fta.Audio(
            autoplay=False,
            on_state_changed=on_audio_state_changed
        )
        page.overlay.append(audio)

        # Componentes de la interfaz
        title_label = ft.Text("Lector de PDF con Voz", size=24, weight=ft.FontWeight.BOLD)
        
        file_label = ft.Text("Ningún archivo seleccionado", color=ft.colors.GREY, italic=True)
        status_label = ft.Text("Listo.", italic=True, size=12)
        progress_label = ft.Text("Fragmento 0 de 0", size=12)

        voice_dropdown = ft.Dropdown(
            label="Voz",
            options=[ft.dropdown.Option(text=k, key=v) for k, v in VOICES.items()],
            value=list(VOICES.values())[0],
            width=300
        )

        speed_slider = ft.Slider(min=-50, max=50, divisions=20, value=0, label="{value}%")
        speed_label = ft.Text("Velocidad: Normal")

        def on_speed_change(e):
            val = int(speed_slider.value)
            if val == 0:
                speed_label.value = "Velocidad: Normal"
            elif val > 0:
                speed_label.value = f"Velocidad: +{val}%"
            else:
                speed_label.value = f"Velocidad: {val}%"
            page.update()

        speed_slider.on_change = on_speed_change

        # Progreso
        seek_slider = ft.Slider(min=0, max=1, value=0, disabled=True)

        def update_buttons():
            play_btn.disabled = not pdf_text_chunks or (is_playing and not is_paused)
            pause_btn.disabled = not is_playing or is_paused
            stop_btn.disabled = not is_playing and not is_paused
            prev_btn.disabled = current_chunk_idx <= 0
            next_btn.disabled = current_chunk_idx >= len(pdf_text_chunks) - 1
            select_btn.disabled = is_playing and not is_paused
            voice_dropdown.disabled = is_playing and not is_paused
            page.update()

        async def generate_and_play_audio():
            nonlocal is_playing, is_paused
            if current_chunk_idx >= len(pdf_text_chunks):
                is_playing = False
                status_label.value = "Lectura finalizada."
                update_buttons()
                return

            chunk = pdf_text_chunks[current_chunk_idx]
            voice = voice_dropdown.value
            val = int(speed_slider.value)
            rate = f"+{val}%" if val >= 0 else f"{val}%"

            status_label.value = f"Generando audio (Fragmento {current_chunk_idx + 1})..."
            page.update()

            try:
                communicate = edge_tts.Communicate(chunk, voice, rate=rate)
                audio_data = b""
                async for data in communicate.stream():
                    if data["type"] == "audio":
                        audio_data += data["data"]
                
                if len(audio_data) > 0:
                    audio_b64 = base64.b64encode(audio_data).decode("utf-8")
                    audio.src_base64 = audio_b64
                    
                    status_label.value = "Leyendo..."
                    # Update progress
                    progress_percent = current_chunk_idx / max(1, len(pdf_text_chunks) - 1)
                    seek_slider.value = progress_percent
                    progress_label.value = f"Fragmento {current_chunk_idx + 1} de {len(pdf_text_chunks)}"
                    
                    audio.play()
                    update_buttons()
                else:
                    status_label.value = "Error: audio vacío."
                    is_playing = False
                    update_buttons()

            except Exception as e:
                status_label.value = f"Error de conexión: {str(e)}"
                is_playing = False
                update_buttons()
            page.update()

        def play_audio(e):
            nonlocal is_playing, is_paused
            if not pdf_text_chunks:
                return

            if is_paused:
                audio.resume()
                is_paused = False
                is_playing = True
                status_label.value = "Reproduciendo..."
                update_buttons()
                return

            is_playing = True
            is_paused = False
            update_buttons()
            
            # Iniciar generación y reproducción asincrónica
            page.run_task(generate_and_play_audio)

        def pause_audio(e):
            nonlocal is_playing, is_paused
            if is_playing and not is_paused:
                audio.pause()
                is_paused = True
                is_playing = False
                status_label.value = "Pausado."
                update_buttons()

        def stop_audio(e):
            nonlocal is_playing, is_paused, current_chunk_idx
            audio.pause()
            is_playing = False
            is_paused = False
            current_chunk_idx = 0
            seek_slider.value = 0
            progress_label.value = f"Fragmento 1 de {len(pdf_text_chunks) if pdf_text_chunks else 0}"
            status_label.value = "Detenido."
            update_buttons()

        def skip_next(e):
            nonlocal current_chunk_idx
            if current_chunk_idx < len(pdf_text_chunks) - 1:
                current_chunk_idx += 1
                if is_playing and not is_paused:
                    audio.pause()
                    page.run_task(generate_and_play_audio)
                else:
                    progress_percent = current_chunk_idx / max(1, len(pdf_text_chunks) - 1)
                    seek_slider.value = progress_percent
                    progress_label.value = f"Fragmento {current_chunk_idx + 1} de {len(pdf_text_chunks)}"
                    update_buttons()

        def skip_prev(e):
            nonlocal current_chunk_idx
            if current_chunk_idx > 0:
                current_chunk_idx -= 1
                if is_playing and not is_paused:
                    audio.pause()
                    page.run_task(generate_and_play_audio)
                else:
                    progress_percent = current_chunk_idx / max(1, len(pdf_text_chunks) - 1)
                    seek_slider.value = progress_percent
                    progress_label.value = f"Fragmento {current_chunk_idx + 1} de {len(pdf_text_chunks)}"
                    update_buttons()

        def on_seek(e):
            nonlocal current_chunk_idx
            if not pdf_text_chunks:
                return
            
            total = len(pdf_text_chunks)
            new_idx = int(seek_slider.value * total)
            if new_idx >= total:
                new_idx = total - 1
                
            if new_idx != current_chunk_idx:
                current_chunk_idx = new_idx
                progress_label.value = f"Fragmento {current_chunk_idx + 1} de {total}"
                if is_playing and not is_paused:
                    audio.pause()
                    page.run_task(generate_and_play_audio)
                else:
                    update_buttons()

        seek_slider.on_change = on_seek

        # Controles de reproducción
        prev_btn = ft.IconButton(icon=ft.icons.SKIP_PREVIOUS, on_click=skip_prev, disabled=True)
        play_btn = ft.IconButton(icon=ft.icons.PLAY_CIRCLE_FILL, icon_color=ft.colors.GREEN, icon_size=50, on_click=play_audio, disabled=True)
        pause_btn = ft.IconButton(icon=ft.icons.PAUSE_CIRCLE_FILLED, icon_size=40, on_click=pause_audio, disabled=True)
        stop_btn = ft.IconButton(icon=ft.icons.STOP_CIRCLE, icon_color=ft.colors.RED, icon_size=40, on_click=stop_audio, disabled=True)
        next_btn = ft.IconButton(icon=ft.icons.SKIP_NEXT, on_click=skip_next, disabled=True)

        controls_row = ft.Row(
            controls=[prev_btn, play_btn, pause_btn, stop_btn, next_btn],
            alignment=ft.MainAxisAlignment.CENTER
        )

        def process_pdf(file_path):
            nonlocal pdf_text_chunks, current_chunk_idx
            pdf_text_chunks.clear()
            current_chunk_idx = 0
            try:
                reader = pypdf.PdfReader(file_path)
                for p in reader.pages:
                    text = p.extract_text()
                    if text:
                        text = text.replace('\n', ' ').strip()
                        sentences = [s.strip() + "." for s in text.split('.') if len(s.strip()) > 5]
                        
                        chunk = ""
                        for s in sentences:
                            if len(chunk) + len(s) > 500:
                                pdf_text_chunks.append(chunk.strip())
                                chunk = s + " "
                            else:
                                chunk += s + " "
                        if chunk.strip():
                            pdf_text_chunks.append(chunk.strip())
                
                if pdf_text_chunks:
                    status_label.value = f"Texto extraído ({len(pdf_text_chunks)} fragmentos)."
                    progress_label.value = f"Fragmento 1 de {len(pdf_text_chunks)}"
                    seek_slider.disabled = False
                    seek_slider.value = 0
                else:
                    status_label.value = "El PDF no contiene texto legible."
            except Exception as e:
                status_label.value = f"Error leyendo PDF: {str(e)}"

            update_buttons()

        def on_file_picked(e: ft.FilePickerResultEvent):
            if e.files and len(e.files) > 0:
                file_path = e.files[0].path
                filename = e.files[0].name
                file_label.value = filename
                status_label.value = "Extrayendo texto..."
                page.update()
                
                # Ejecutar procesamiento del PDF
                process_pdf(file_path)

        file_picker = ft.FilePicker(on_result=on_file_picked)
        page.overlay.append(file_picker)

        select_btn = ft.ElevatedButton(
            text="Seleccionar PDF", 
            icon=ft.icons.FILE_UPLOAD,
            on_click=lambda _: file_picker.pick_files(allowed_extensions=["pdf"])
        )

        # Layout de la vista
        page.add(
            ft.Column(
                controls=[
                    title_label,
                    ft.Divider(height=20, color=ft.colors.TRANSPARENT),
                    
                    # Card de archivo
                    ft.Card(
                        content=ft.Container(
                            padding=15,
                            content=ft.Column([
                                select_btn,
                                file_label
                            ], horizontal_alignment=ft.CrossAxisAlignment.CENTER)
                        )
                    ),
                    
                    ft.Divider(height=10, color=ft.colors.TRANSPARENT),
                    
                    # Configuracion
                    ft.Card(
                        content=ft.Container(
                            padding=15,
                            content=ft.Column([
                                voice_dropdown,
                                ft.Row([speed_label], alignment=ft.MainAxisAlignment.START),
                                speed_slider
                            ])
                        )
                    ),
                    
                    ft.Divider(height=10, color=ft.colors.TRANSPARENT),
                    
                    # Reproductor
                    ft.Card(
                        content=ft.Container(
                            padding=15,
                            content=ft.Column([
                                controls_row,
                                seek_slider,
                                progress_label,
                                ft.Container(padding=ft.padding.only(top=10), content=status_label)
                            ], horizontal_alignment=ft.CrossAxisAlignment.CENTER)
                        )
                    )
                ],
                scroll=ft.ScrollMode.AUTO,
                horizontal_alignment=ft.CrossAxisAlignment.CENTER
            )
        )

    if __name__ == "__main__":
        ft.app(target=main)

except Exception as e:
    error_trace = traceback.format_exc()
    def emergency_main(page: ft.Page):
        page.scroll = "auto"
        page.add(
            ft.Text("CRITICAL ERROR", size=24, color="red", weight=ft.FontWeight.BOLD),
            ft.Text("Ocurrió un error al iniciar la aplicación. Mándame captura de esto:", color="red"),
            ft.Text(error_trace, selectable=True, size=12)
        )
    ft.app(target=emergency_main)
