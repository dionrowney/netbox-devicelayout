import copy

from django.db.models.signals import post_save
from django.dispatch import receiver

from dcim.models import Device


@receiver(post_save, sender=Device)
def copy_device_type_layout_to_device(sender, instance, created, **kwargs):
    """When a new Device is created, copy its device type's layout as the starting point."""
    if not created:
        return
    if not instance.device_type_id:
        return

    from .models import DeviceLayout, DeviceTypeLayout

    try:
        dt_layout = DeviceTypeLayout.objects.get(device_type_id=instance.device_type_id)
    except DeviceTypeLayout.DoesNotExist:
        return

    if not dt_layout.layout:
        return

    DeviceLayout.objects.get_or_create(
        device=instance,
        defaults={"layout": copy.deepcopy(dt_layout.layout)},
    )
