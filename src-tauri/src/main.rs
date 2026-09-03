// Windows release builds get no console window: this is a desktop application, and a
// terminal flashing up behind it looks like something went wrong.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    basilisk_step_studio_lib::run()
}
